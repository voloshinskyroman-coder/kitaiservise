import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "outreach.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session       TEXT    NOT NULL UNIQUE,
        phone         TEXT,
        status        TEXT    DEFAULT 'active',
        daily_limit   INTEGER DEFAULT 50,
        hourly_limit  INTEGER DEFAULT 8,
        paused_until  TEXT,
        flood_count   INTEGER DEFAULT 0,
        created_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id       TEXT    UNIQUE,
        username    TEXT,
        last_seen   TEXT,
        status      TEXT    DEFAULT 'new',
        account_id  INTEGER REFERENCES accounts(id),
        imported_at TEXT    DEFAULT (datetime('now')),
        sent_at     TEXT,
        replied_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id),
        account_id  INTEGER REFERENCES accounts(id),
        direction   TEXT    NOT NULL,
        text        TEXT,
        tg_msg_id   INTEGER,
        sent_at     TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id      INTEGER NOT NULL REFERENCES contacts(id),
        account_id      INTEGER REFERENCES accounts(id),
        status          TEXT    DEFAULT 'new',
        ai_draft        TEXT,
        operator_reply  TEXT,
        created_at      TEXT    DEFAULT (datetime('now')),
        updated_at      TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operator_actions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  INTEGER REFERENCES conversations(id),
        action           TEXT,
        text_sent        TEXT,
        acted_at         TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT    NOT NULL,
        type    TEXT    NOT NULL,
        detail  TEXT,
        done_at TEXT    DEFAULT (datetime('now'))
    );
    """)
    # Миграции для существующих баз (добавляем колонку если нет)
    try:
        conn.execute("ALTER TABLE accounts ADD COLUMN flood_count INTEGER DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # колонка уже есть
    conn.close()


def get_account(session: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE session = ?", (session,)).fetchone()
        return dict(row) if row else None


def upsert_account(session: str, daily_limit: int = 50, hourly_limit: int = 8) -> int:
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO accounts (session, daily_limit, hourly_limit)
            VALUES (?, ?, ?)
            ON CONFLICT(session) DO UPDATE SET
                daily_limit  = CASE WHEN excluded.daily_limit  != 50 THEN excluded.daily_limit  ELSE daily_limit  END,
                hourly_limit = CASE WHEN excluded.hourly_limit != 8  THEN excluded.hourly_limit ELSE hourly_limit END
        """, (session, daily_limit, hourly_limit))
        conn.commit()
        row = conn.execute("SELECT id FROM accounts WHERE session = ?", (session,)).fetchone()
        return row["id"]


def pause_account(account_id: int, seconds: int):
    from datetime import datetime, timedelta, timezone
    until = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
    with get_conn() as conn:
        conn.execute("UPDATE accounts SET status='paused', paused_until=? WHERE id=?", (until, account_id))
        conn.commit()
    print(f"[account {account_id}] пауза до {until}")


def resume_account(account_id: int):
    with get_conn() as conn:
        conn.execute("UPDATE accounts SET status='active', paused_until=NULL WHERE id=?", (account_id,))
        conn.commit()


def increment_flood_count(account_id: int) -> int:
    """Увеличивает счётчик PeerFlood и возвращает новое значение."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE accounts SET flood_count = COALESCE(flood_count, 0) + 1 WHERE id=?",
            (account_id,)
        )
        conn.commit()
        row = conn.execute("SELECT flood_count FROM accounts WHERE id=?", (account_id,)).fetchone()
        return row["flood_count"] if row else 1


def reset_flood_count(account_id: int):
    """Сбрасывает счётчик PeerFlood после успешной отправки."""
    with get_conn() as conn:
        conn.execute("UPDATE accounts SET flood_count=0 WHERE id=?", (account_id,))
        conn.commit()


def mark_account_dead(account_id: int):
    """Помечает аккаунт как мёртвый — больше не используется."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE accounts SET status='dead', paused_until=NULL WHERE id=?",
            (account_id,)
        )
        conn.commit()


def sent_today(account_id: int) -> int:
    with get_conn() as conn:
        row = conn.execute("""
            SELECT COUNT(*) as cnt FROM messages
            WHERE account_id=? AND direction='out' AND date(sent_at)=date('now')
        """, (account_id,)).fetchone()
        return row["cnt"]


def sent_this_hour(account_id: int) -> int:
    with get_conn() as conn:
        row = conn.execute("""
            SELECT COUNT(*) as cnt FROM messages
            WHERE account_id=? AND direction='out'
            AND sent_at >= datetime('now', '-1 hour')
        """, (account_id,)).fetchone()
        return row["cnt"]


def get_pending_contacts(account_id: int, limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT * FROM contacts
            WHERE status IN ('new', 'failed') AND replied_at IS NULL AND (account_id IS NULL OR account_id=?)
            ORDER BY
                CASE WHEN status='new' THEN 0 ELSE 1 END ASC,
                CASE WHEN last_seen IS NOT NULL THEN 0 ELSE 1 END ASC,
                last_seen DESC,
                id ASC
            LIMIT ?
        """, (account_id, limit)).fetchall()
        return [dict(r) for r in rows]


def mark_contact(contact_id: int, status: str, account_id: int | None = None):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        if status == "sent":
            conn.execute("""
                UPDATE contacts SET status=?, sent_at=?, account_id=?
                WHERE id=?
            """, (status, now, account_id, contact_id))
        else:
            conn.execute("UPDATE contacts SET status=? WHERE id=?", (status, contact_id))
        conn.commit()


def add_message(contact_id: int, account_id: int, direction: str,
                text: str, tg_msg_id: int | None = None, template_name: str | None = None):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO messages (contact_id, account_id, direction, text, tg_msg_id, template_name)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (contact_id, account_id, direction, text, tg_msg_id, template_name))
        conn.commit()


def get_contact_by_tg_id(tg_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM contacts WHERE tg_id=?", (tg_id,)).fetchone()
        return dict(row) if row else None


def upsert_conversation(contact_id: int, account_id: int, ai_draft: str = "") -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM conversations WHERE contact_id=?", (contact_id,)
        ).fetchone()
        if row:
            conn.execute("""
                UPDATE conversations SET ai_draft=?, updated_at=datetime('now')
                WHERE id=?
            """, (ai_draft, row["id"]))
            conn.commit()
            return row["id"]
        cur = conn.execute("""
            INSERT INTO conversations (contact_id, account_id, ai_draft)
            VALUES (?, ?, ?)
        """, (contact_id, account_id, ai_draft))
        conn.commit()
        return cur.lastrowid


def get_stats() -> dict:
    with get_conn() as conn:
        total     = conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
        sent      = conn.execute("SELECT COUNT(*) FROM contacts WHERE status='sent'").fetchone()[0]
        replied   = conn.execute("SELECT COUNT(*) FROM contacts WHERE status='replied'").fetchone()[0]
        failed    = conn.execute("SELECT COUNT(*) FROM contacts WHERE status='failed'").fetchone()[0]
        skipped   = conn.execute("SELECT COUNT(*) FROM contacts WHERE status='skipped'").fetchone()[0]
        return {
            "total": total, "sent": sent, "replied": replied,
            "failed": failed, "skipped": skipped,
            "reply_rate": round(replied / sent * 100, 1) if sent else 0,
        }
