"""
Сканирует все аккаунты и ищет пропущенные ответы в личке.
Вносит найденные ответы в базу (direction='in').
Использует копии session-файлов чтобы не конфликтовать с daemon.
"""
import asyncio, json, os, shutil, sqlite3
from pathlib import Path
from telethon import TelegramClient
from telethon.tl.types import User

OUTREACH_DIR  = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent)
DB_PATH       = OUTREACH_DIR / "outreach.db"
ACCOUNTS_FILE = OUTREACH_DIR / "accounts.json"
TMP_DIR       = Path("/tmp/scan_sessions")


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn


def get_sent_contacts():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, tg_id, username, account_id FROM contacts WHERE status IN ('sent','replied')"
        ).fetchall()
        return [dict(r) for r in rows]


def get_existing_in_msg_ids(contact_id: int) -> set:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT tg_msg_id FROM messages WHERE contact_id=? AND direction='in' AND tg_msg_id IS NOT NULL",
            (contact_id,)
        ).fetchall()
        return {r["tg_msg_id"] for r in rows}


def save_message(contact_id: int, account_id: int, text: str, tg_msg_id: int, sent_at: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO messages (contact_id, account_id, direction, text, tg_msg_id, sent_at) VALUES (?,?,?,?,?,?)",
            (contact_id, account_id, "in", text, tg_msg_id, sent_at)
        )
        conn.execute(
            "UPDATE contacts SET status='replied', replied_at=? WHERE id=? AND status='sent'",
            (sent_at, contact_id)
        )
        conn.commit()


async def scan_account(acc_cfg: dict, contacts_by_tg_id: dict, contacts_by_uname: dict, tmp_dir: Path) -> int:
    session = acc_cfg["session"]
    orig = OUTREACH_DIR / (session + ".session")
    if not orig.exists():
        print(f"  [{session}] нет session файла — пропускаю")
        return 0

    proxy_arg = tuple(acc_cfg["proxy"]) if acc_cfg.get("proxy") else None
    if proxy_arg is None:
        print(f"  [{session}] нет прокси — пропускаю")
        return 0

    tmp_session = tmp_dir / session
    shutil.copy2(str(orig), str(tmp_session) + ".session")

    client = TelegramClient(str(tmp_session), acc_cfg["api_id"], acc_cfg["api_hash"], proxy=proxy_arg)
    found = 0
    try:
        await client.connect()
        if not await client.is_user_authorized():
            print(f"  [{session}] не авторизован — пропускаю")
            return 0

        me = await client.get_me()
        print(f"  [{session}] {me.first_name} — сканирую диалоги...")

        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            if not isinstance(entity, User):
                continue

            tg_id = str(entity.id)
            uname = (entity.username or "").lower()

            # Матчим по tg_id или username
            contact = contacts_by_tg_id.get(tg_id) or contacts_by_uname.get(uname)
            if not contact:
                continue

            # Обновляем tg_id если не был сохранён
            if not contacts_by_tg_id.get(tg_id) and tg_id:
                with get_conn() as conn:
                    conn.execute("UPDATE contacts SET tg_id=? WHERE id=? AND (tg_id IS NULL OR tg_id='')",
                                 (tg_id, contact["id"]))
                    conn.commit()
                contacts_by_tg_id[tg_id] = contact

            existing = get_existing_in_msg_ids(contact["id"])

            async for msg in client.iter_messages(entity, limit=50):
                if msg.out:
                    continue
                if not msg.text:
                    continue
                if msg.id in existing:
                    continue

                sent_at = msg.date.isoformat() if msg.date else None
                save_message(contact["id"], contact["account_id"] or 0, msg.text, msg.id, sent_at)
                print(f"    ✅ @{entity.username or tg_id}: {msg.text[:100]!r}")
                found += 1

    except Exception as e:
        print(f"  [{session}] ошибка: {e}")
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    return found


def get_disconnected_sessions() -> set:
    """Только аккаунты, которых демон сам исключил из живого пула (status='disconnected').
    Копия session-файла содержит тот же auth_key, что и оригинал — подключаться этой копией
    можно ТОЛЬКО пока демон точно не держит по этому аккаунту живое соединение, иначе
    Telegram видит два одновременных подключения одним ключом и отзывает его (AuthKeyDuplicated)."""
    with get_conn() as conn:
        rows = conn.execute("SELECT session FROM accounts WHERE status='disconnected'").fetchall()
        return {r["session"] for r in rows}


async def main():
    TMP_DIR.mkdir(exist_ok=True)

    accounts = json.loads(ACCOUNTS_FILE.read_text())
    disconnected = get_disconnected_sessions()
    skipped = [a["session"] for a in accounts if a["session"] not in disconnected]
    accounts = [a for a in accounts if a["session"] in disconnected]
    print(f"Пропускаю {len(skipped)} аккаунтов, которые сейчас живые в демоне (не трогаем, чтобы не словить AuthKeyDuplicated)")
    print(f"Сканирую только {len(accounts)} отключённых аккаунтов\n")

    contacts = get_sent_contacts()
    contacts_by_tg_id  = {c["tg_id"]: c for c in contacts if c["tg_id"]}
    contacts_by_uname  = {c["username"].lower(): c for c in contacts if c["username"]}
    print(f"Контактов для проверки: {len(contacts)}")
    print(f"Аккаунтов: {len(accounts)}\n")

    total = 0
    for acc in accounts:
        found = await scan_account(acc, contacts_by_tg_id, contacts_by_uname, TMP_DIR)
        total += found
        await asyncio.sleep(1)

    print(f"\nГотово. Найдено и добавлено новых ответов: {total}")

    # Чистим временные файлы
    shutil.rmtree(str(TMP_DIR), ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
