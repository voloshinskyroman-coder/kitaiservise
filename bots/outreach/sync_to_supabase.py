"""
Синхронизирует outreach.db → Supabase каждые 5 минут.
Автоматически тянет имя и аватар из Telegram для новых аккаунтов.
"""
import asyncio, hashlib, json, os, random, sqlite3, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SUPABASE_URL  = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OUTREACH_DIR  = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent)
DB_PATH       = str(OUTREACH_DIR / "outreach.db")
ACCOUNTS_JSON = str(OUTREACH_DIR / "accounts.json")
AVATAR_DIR    = Path("/tmp/avatars")
BUCKET        = "avatars"

LLM_API_KEY  = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
SENTIMENT_MODEL = "openai/gpt-4o"
SENTIMENT_BATCH_LIMIT = 20  # не больше N за один цикл синка, чтобы не улететь по цене/rate limit

MSK = timezone(timedelta(hours=3))

def today_msk():
    return datetime.now(MSK).strftime("%Y-%m-%d")

_TIER_RANGES = {
    'new':    (0, 0),
    'blue':   (2, 4),
    'green':  (4, 6),
    'orange': (6, 8),
    'purple': (8, 10),
    'yellow': (0, 1),
    'red':    (0, 0),
    'black':  (0, 0),
}

def get_tier(status, paused_until, created_at):
    now = datetime.now(timezone.utc)
    if status == 'dead':
        return 'black'
    if paused_until:
        try:
            pu = datetime.fromisoformat(str(paused_until))
            if pu.tzinfo is None:
                pu = pu.replace(tzinfo=timezone.utc)
            if pu > now:
                return 'red'
            if (now - pu).total_seconds() < 86400:
                return 'yellow'
        except Exception:
            pass
    if created_at:
        try:
            ca = datetime.fromisoformat(str(created_at))
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            age = (now.date() - ca.date()).days + 1
            if age <= 2:   return 'new'
            if age <= 7:   return 'blue'
            if age <= 14:  return 'green'
            if age <= 21:  return 'orange'
            return 'purple'
        except Exception:
            pass
    return 'purple'

def compute_daily_limit(session, tier):
    lo, hi = _TIER_RANGES.get(tier, (3, 5))
    if lo == hi:
        return lo
    from datetime import date
    today = int(date.today().strftime("%Y%m%d"))
    stable = int(hashlib.md5(session.encode()).hexdigest(), 16)
    rng = random.Random((stable ^ today) & 0xFFFFFFFF)
    return rng.randint(lo, hi)

HDRS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def supabase_req(method, path, data=None, params=""):
    url = f"{SUPABASE_URL}{path}{params}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        **HDRS,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def upsert(table, rows, on_conflict=None):
    if not rows:
        return
    params = f"?on_conflict={on_conflict}" if on_conflict else ""
    for i in range(0, len(rows), 200):
        status, body = supabase_req("POST", f"/rest/v1/{table}", rows[i:i+200], params)
        if status >= 300:
            print(f"[sync] upsert {table} failed ({status}): {body[:300]}")

def upload_avatar(path: Path, filename: str) -> str:
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}"
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        **HDRS, "Content-Type": "image/jpeg", "x-upsert": "true",
    })
    try:
        with urllib.request.urlopen(req, timeout=8):
            pass
    except urllib.error.HTTPError as e:
        # Бакет "avatars" мог ещё не быть создан в Supabase Storage — не роняем синк.
        print(f"[sync] avatar upload skip ({filename}): {e}")
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{filename}"

def get_supabase_accounts():
    status, body = supabase_req("GET", "/rest/v1/outreach_accounts", params="?select=id,session,name,avatar_url")
    return json.loads(body) if status == 200 else []

async def fetch_name_and_avatar(acc_cfg: dict) -> tuple:
    try:
        from telethon import TelegramClient
        session = acc_cfg["session"]
        proxy_arg = tuple(acc_cfg["proxy"]) if acc_cfg.get("proxy") else None
        if proxy_arg is None:
            print(f"[sync] {session}: нет прокси — пропускаю подтяжку профиля")
            return None, None
        client = TelegramClient(str(OUTREACH_DIR / session), acc_cfg["api_id"], acc_cfg["api_hash"], proxy=proxy_arg)
        await client.connect()
        me = await client.get_me()
        name = (me.first_name or "").strip()
        if me.last_name:
            name = name + " " + me.last_name[0] + "."

        AVATAR_DIR.mkdir(exist_ok=True)
        photo_path = AVATAR_DIR / f"{session}.jpg"
        dl = await client.download_profile_photo(me, file=str(photo_path), download_big=False)
        await client.disconnect()

        avatar_url = upload_avatar(photo_path, f"{session}.jpg") if dl else None
        return name, avatar_url
    except Exception as e:
        print(f"[sync] avatar fetch error {acc_cfg['session']}: {e}")
        return None, None

async def sync_missing_profiles(acc_cfgs: dict, sb_accounts: list, active_sessions: set = None):
    missing = [a for a in sb_accounts if not a.get("name") or not a.get("avatar_url")]
    if active_sessions is not None:
        missing = [a for a in missing if a["session"] in active_sessions]
    if not missing:
        return
    print(f"[sync] подтягиваю профили для {len(missing)} аккаунтов...")
    for sb_acc in missing:
        session = sb_acc["session"]
        cfg = acc_cfgs.get(session)
        if not cfg:
            continue
        name, avatar_url = await fetch_name_and_avatar(cfg)
        if name or avatar_url:
            patch = {}
            if name: patch["name"] = name
            if avatar_url: patch["avatar_url"] = avatar_url
            supabase_req("PATCH", f"/rest/v1/outreach_accounts",
                data=patch, params=f"?session=eq.{session}")
            print(f"[sync] профиль обновлён: {name} ({session})")
        await asyncio.sleep(1)

SENTIMENT_SYSTEM_PROMPT = """Ты анализируешь переписку менеджера компании KitaiService (доставка товаров
из Китая под ключ: Taobao/1688/Pinduoduo, растаможка) с человеком, которому написали первыми (холодная
рассылка). Тебе дана вся переписка целиком.

Классифицируй ВЕСЬ разговор целиком, не только последнюю реплику:
- "green" — реальный интерес, готов двигаться дальше: согласился на расчёт, даёт детали груза
  (категория/вес/объём), спрашивает как оформить заявку.
- "warm" — было реальное вовлечение (спрашивал про сроки/стоимость/растаможку, писал развёрнуто про свой
  товар), но разговор завис на возражении или оборвался без явного да/нет — стоит дожимать вручную.
- "red" — явный отказ или неактуальность: не интересно, уже есть карго/логист/поставщик доставки,
  сам возит, просит не писать, "спасибо не надо" и т.п. — даже если сформулировано мягко.
- "gray" — коротко, неинформативно, слишком рано судить, не по теме — реального вовлечения не было.

Ответь строго JSON без пояснений вокруг: {"sentiment": "green"|"warm"|"red"|"gray", "reason": "<кратко по-русски, 1 предложение>"}"""


def classify_sentiment(history: list) -> tuple[str, str] | None:
    if not LLM_API_KEY:
        return None
    lines = []
    for m in history:
        role = "Менеджер" if m["direction"] == "out" else "Человек"
        lines.append(f"{role}: {m['text']}")
    payload = {
        "model": SENTIMENT_MODEL,
        "messages": [
            {"role": "system", "content": SENTIMENT_SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(lines)},
        ],
        "temperature": 0,
        "max_tokens": 150,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        LLM_BASE_URL.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            content = json.loads(resp.read())["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        sentiment = parsed.get("sentiment")
        if sentiment not in ("green", "warm", "red", "gray"):
            return None
        return sentiment, (parsed.get("reason") or "")[:300]
    except Exception as e:
        print(f"[sentiment] ошибка классификации: {e}")
        return None


def sync_reply_sentiment(conn):
    """Классифицирует реакцию ответивших контактов через LLM (полный контекст переписки),
    не больше SENTIMENT_BATCH_LIMIT за цикл. sentiment_msg_count хранит, сколько сообщений
    было учтено в последней оценке — как только переписка отросла дальше этого числа
    (новый ответ клиента или менеджера), контакт снова попадает в кандидаты на переоценку,
    вместо того чтобы кэшироваться навсегда по первому сообщению."""
    if not LLM_API_KEY:
        return
    # status='eq.replied' раньше пропускал тех, кого после ответа перевели в другой статус
    # (например 'skipped' — оператор закрыл диалог) — они навсегда оставались без sentiment,
    # хотя реально отвечали. history всё равно пуст для тех, кто не писал (см. continue ниже),
    # так что лишних вызовов LLM это не добавляет — только чуть шире кандидатский список.
    status, body = supabase_req(
        "GET", "/rest/v1/outreach_contacts",
        params="?select=id,sentiment_msg_count&status=neq.new"
    )
    if status != 200:
        return
    known_counts = {row["id"]: row.get("sentiment_msg_count") or 0 for row in json.loads(body)}
    if not known_counts:
        return

    actual = {}
    for r in conn.execute(
        "SELECT contact_id, COUNT(*) AS cnt, MAX(id) AS last_id FROM messages "
        "WHERE text IS NOT NULL GROUP BY contact_id"
    ).fetchall():
        actual[r["contact_id"]] = (r["cnt"], r["last_id"])

    # Кандидаты — где реальных сообщений больше, чем учтено в последней оценке.
    # Сортируем по last_id (свежая переписка) — за один цикл берём не больше лимита.
    pending = [cid for cid, known in known_counts.items() if actual.get(cid, (0, 0))[0] > known]
    pending.sort(key=lambda cid: actual[cid][1], reverse=True)
    pending = pending[:SENTIMENT_BATCH_LIMIT]
    if not pending:
        return

    print(f"[sentiment] (пере)оцениваю {len(pending)} контактов...")
    for contact_id in pending:
        history = conn.execute(
            "SELECT direction, text FROM messages WHERE contact_id=? AND text IS NOT NULL ORDER BY id ASC",
            (contact_id,)
        ).fetchall()
        if not history:
            continue
        result = classify_sentiment([dict(h) for h in history])
        if not result:
            continue
        sentiment, reason = result
        supabase_req("PATCH", "/rest/v1/outreach_contacts",
                     data={"sentiment": sentiment, "sentiment_reason": reason, "sentiment_msg_count": len(history)},
                     params=f"?id=eq.{contact_id}")
    print(f"[sentiment] готово")


def pull_pending_replies():
    """Забирает ответы оператора из админки (Supabase.outreach_pending_replies),
    кладёт их в локальную conversations.ai_draft и ставит в очередь
    pending_operator_sends — оттуда их разберёт poll_pending_sends() в демоне."""
    status, body = supabase_req("GET", "/rest/v1/outreach_pending_replies",
                                 params="?processed=eq.false&order=id.asc")
    if status != 200:
        print(f"[sync] pull_pending_replies GET failed ({status}): {body[:300]}")
        return
    rows = json.loads(body)
    if not rows:
        return

    conn = sqlite3.connect(DB_PATH, timeout=20)
    now_local = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    for row in rows:
        try:
            action = row.get("action") or "send"
            conv = conn.execute(
                "SELECT id FROM conversations WHERE contact_id=? AND account_id=? "
                "ORDER BY id DESC LIMIT 1",
                (row["contact_id"], row["account_id"])
            ).fetchone()

            if action == "skip":
                # Пропустить — просто закрываем диалог, ничего не отправляем клиенту.
                if conv:
                    conn.execute(
                        "UPDATE conversations SET status='closed', updated_at=? WHERE id=?",
                        (now_local, conv[0])
                    )
                conn.commit()
                supabase_req("PATCH", "/rest/v1/outreach_pending_replies",
                             data={"processed": True}, params=f"?id=eq.{row['id']}")
                print(f"[sync] pending_reply id={row['id']} → skip")
                continue

            if conv:
                conv_id = conv[0]
                conn.execute(
                    "UPDATE conversations SET ai_draft=?, status='open', updated_at=? WHERE id=?",
                    (row["text"], now_local, conv_id)
                )
            else:
                cur = conn.execute(
                    "INSERT INTO conversations (contact_id, account_id, status, ai_draft, updated_at) "
                    "VALUES (?, ?, 'open', ?, ?)",
                    (row["contact_id"], row["account_id"], row["text"], now_local)
                )
                conv_id = cur.lastrowid
            conn.execute("INSERT INTO pending_operator_sends (conv_id) VALUES (?)", (conv_id,))
            conn.commit()
            supabase_req("PATCH", "/rest/v1/outreach_pending_replies",
                         data={"processed": True}, params=f"?id=eq.{row['id']}")
            print(f"[sync] pending_reply id={row['id']} → conv={conv_id}")
        except Exception as e:
            print(f"[sync] pull_pending_replies row {row.get('id')} error: {e}")
    conn.close()


def run():
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        pull_pending_replies()
    except Exception as e:
        print(f"[sync] pull_pending_replies error: {e}")

    acc_cfgs = {}
    try:
        for a in json.loads(Path(ACCOUNTS_JSON).read_text()):
            acc_cfgs[a["session"]] = a
    except Exception as e:
        print(f"[sync] accounts.json error: {e}")

    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row

    # ── accounts ──────────────────────────────────────────────────────────────
    cur = conn.execute("SELECT * FROM accounts")
    today = today_msk()
    acc_rows = []
    for r in cur.fetchall():
        session = r["session"]
        sent_today = conn.execute(
            "SELECT COUNT(*) FROM messages m JOIN contacts c ON c.id=m.contact_id "
            "WHERE m.account_id=? AND m.direction='out' AND substr(m.sent_at,1,10)=?",
            (r["id"], today)
        ).fetchone()[0]
        cfg = acc_cfgs.get(session, {})
        tier = get_tier(r["status"], r["paused_until"], r["created_at"])
        acc_rows.append({
            "id": r["id"], "session": session,
            "phone": cfg.get("phone"), "gender": cfg.get("gender"),
            "status": r["status"] or "active",
            "daily_limit": compute_daily_limit(session, tier),
            "hourly_limit": r["hourly_limit"],
            "paused_until": r["paused_until"],
            "created_at": r["created_at"],
            "sent_today": sent_today, "synced_at": now_iso,
        })
    live_rows = [r for r in acc_rows if r["status"] != "dead"]
    upsert("outreach_accounts", live_rows)
    print(f"[sync] accounts: {len(live_rows)} live (skipped {len(acc_rows) - len(live_rows)} dead)")

    # ── удаляем из Supabase мёртвых и аккаунты которых нет в локальной БД ────
    try:
        local_sessions = {r["session"] for r in live_rows}
        sb_all = get_supabase_accounts()
        to_delete = [a["session"] for a in sb_all if a["session"] not in local_sessions]
        for session in to_delete:
            supabase_req("DELETE", "/rest/v1/outreach_accounts", params=f"?session=eq.{session}")
            print(f"[sync] удалён из Supabase: {session}")
    except Exception as e:
        print(f"[sync] delete error: {e}")

    # ── flood_count (отдельный PATCH — колонка может ещё не быть в Supabase) ──
    try:
        for r in conn.execute("SELECT id, flood_count FROM accounts WHERE flood_count > 0").fetchall():
            supabase_req("PATCH", "/rest/v1/outreach_accounts",
                         data={"flood_count": r["flood_count"]},
                         params=f"?id=eq.{r['id']}")
        print(f"[sync] flood_count updated")
    except Exception as e:
        print(f"[sync] flood_count skip (колонка ещё не добавлена в Supabase): {e}")

    # ── contacts ──────────────────────────────────────────────────────────────
    id_to_session = {r["id"]: r["session"] for r in conn.execute("SELECT id, session FROM accounts")}
    contact_rows = []
    for r in conn.execute(
        "SELECT * FROM contacts WHERE imported_at >= datetime('now','-30 days') "
        "OR sent_at >= datetime('now','-30 days') OR replied_at >= datetime('now','-30 days')"
    ).fetchall():
        contact_rows.append({
            "id": r["id"], "tg_id": r["tg_id"], "username": r["username"],
            "status": r["status"] or "new", "account_id": r["account_id"],
            "account_session": id_to_session.get(r["account_id"]) if r["account_id"] else None,
            "imported_at": r["imported_at"], "sent_at": r["sent_at"],
            "replied_at": r["replied_at"], "synced_at": now_iso,
        })
    upsert("outreach_contacts", contact_rows)
    print(f"[sync] contacts: {len(contact_rows)}")

    # ── messages ──────────────────────────────────────────────────────────────
    msg_rows = []
    for r in conn.execute("SELECT * FROM messages WHERE sent_at >= datetime('now','-30 days')").fetchall():
        msg_rows.append({
            "id": r["id"], "contact_id": r["contact_id"], "account_id": r["account_id"],
            "direction": r["direction"], "text": r["text"],
            "sent_at": r["sent_at"], "synced_at": now_iso,
        })
    upsert("outreach_messages", msg_rows)
    print(f"[sync] messages: {len(msg_rows)}")

    # ── conversations ─────────────────────────────────────────────────────────
    conv_rows = []
    for r in conn.execute("SELECT * FROM conversations WHERE updated_at >= datetime('now','-30 days')").fetchall():
        conv_rows.append({
            "id": r["id"], "contact_id": r["contact_id"], "account_id": r["account_id"],
            "status": r["status"] or "open", "ai_draft": r["ai_draft"],
            "created_at": r["created_at"], "updated_at": r["updated_at"],
            "synced_at": now_iso,
        })
    upsert("outreach_conversations", conv_rows)
    print(f"[sync] conversations: {len(conv_rows)}")


    # ── activity_log ──────────────────────────────────────────────────────────
    act_rows = []
    try:
        for r in conn.execute("SELECT * FROM activity_log WHERE date(done_at) >= date('now','-7 days')").fetchall():
            act_rows.append({
                "session":   r["session"],
                "type":      r["type"],
                "detail":    r["detail"],
                "done_at":   r["done_at"],
                "synced_at": now_iso,
            })
        upsert("outreach_activity", act_rows, on_conflict="session,type,done_at")
        print(f"[sync] activity: {len(act_rows)}")
    except Exception as e:
        print(f"[sync] activity error: {e}")

    try:
        sync_reply_sentiment(conn)
    except Exception as e:
        print(f"[sentiment] sync error: {e}")

    conn.close()
    print(f"[sync] done at {now_iso}")

    # ── автоматически подтянуть имя+аватар для новых аккаунтов ───────────────
    skip_statuses = {"disconnected", "dead", "auth_error"}
    active_sessions = {r["session"] for r in acc_rows if r["status"] not in skip_statuses}
    sb_accounts = get_supabase_accounts()
    async def _run_profiles():
        try:
            await asyncio.wait_for(sync_missing_profiles(acc_cfgs, sb_accounts, active_sessions), timeout=25)
        except asyncio.TimeoutError:
            print("[sync] sync_missing_profiles timeout — пропускаем")
    asyncio.run(_run_profiles())

    # ── backfill has_avatar для аккаунтов у которых аватар уже есть в Supabase ─
    try:
        conn2 = sqlite3.connect(DB_PATH, timeout=20)
        for sb_acc in sb_accounts:
            if sb_acc.get("avatar_url"):
                conn2.execute(
                    "UPDATE accounts SET has_avatar = 1 WHERE session = ? AND has_avatar != 1",
                    (sb_acc["session"],)
                )
        conn2.commit()
        conn2.close()
    except Exception as e:
        print(f"[sync] has_avatar backfill error: {e}")

if __name__ == "__main__":
    run()
