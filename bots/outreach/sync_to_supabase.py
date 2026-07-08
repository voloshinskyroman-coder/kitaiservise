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

def upsert(table, rows):
    if not rows:
        return
    for i in range(0, len(rows), 200):
        supabase_req("POST", f"/rest/v1/{table}", rows[i:i+200])

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
        client = TelegramClient(str(OUTREACH_DIR / session), acc_cfg["api_id"], acc_cfg["api_hash"])
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

def run():
    now_iso = datetime.now(timezone.utc).isoformat()

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
                "id":        r["id"],
                "session":   r["session"],
                "type":      r["type"],
                "detail":    r["detail"],
                "done_at":   r["done_at"],
                "synced_at": now_iso,
            })
        upsert("outreach_activity", act_rows)
        print(f"[sync] activity: {len(act_rows)}")
    except Exception as e:
        print(f"[sync] activity error: {e}")
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
