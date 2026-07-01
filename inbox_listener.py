"""
Слушает входящие на основном аккаунте Kitai Servise.
Сохраняет контакты и сообщения в Supabase.
Классифицирует диалоги через GPT-4o-mini.
"""
import asyncio, json, os, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
from telethon import TelegramClient, events
from telethon.tl.types import User

_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_KEY"]
OPENAI_KEY    = os.environ.get("LLM_API_KEY", "")
SESSION       = "/opt/kitaiservise/outreach/kitai_inbox"
API_ID        = int(os.environ["API_ID"])
API_HASH      = os.environ["API_HASH"]
SYSTEM_IDS    = {777000, 1, 93372553}

HDRS_SB = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

tables_ready = False


def supabase_req(method, path, data=None, params=""):
    import time
    url = f"{SUPABASE_URL}{path}{params}"
    body = json.dumps(data).encode() if data else None
    for attempt in range(3):
        req = urllib.request.Request(url, data=body, method=method, headers=HDRS_SB)
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                return r.status, r.read()
        except Exception as e:
            if attempt < 2:
                time.sleep(2)
            else:
                raise
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()


def check_tables():
    global tables_ready
    s, _ = supabase_req("GET", "/rest/v1/inbox_leads", params="?limit=0")
    tables_ready = s == 200
    if not tables_ready:
        print("[inbox] ⏳ Таблицы не готовы")
    return tables_ready


def classify_dialog(messages: list[dict]) -> dict:
    """messages = [{"role": "user"|"assistant", "content": "..."}]"""
    if not messages:
        return {"status": "new", "ai_note": ""}

    dialog_text = "\n".join(
        f"{'Клиент' if m['role'] == 'user' else 'Kitai Servise'}: {m['content']}"
        for m in messages[-20:]
    )

    prompt = f"""Ты классифицируешь входящие сообщения клиентов логистической компании Kitai Servise.

Диалог:
{dialog_text}

Верни ТОЛЬКО JSON без markdown:
{{
  "status": "interested" | "thinking" | "meeting" | "refused" | "new",
  "ai_note": "краткое резюме одним предложением"
}}

Статусы:
- interested: клиент интересуется ценой, услугами, задаёт конкретные вопросы
- thinking: думает, не отказал, но ещё не готов
- meeting: договорились о встрече или звонке
- refused: явный отказ
- new: первый контакт или непонятно"""

    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 150,
        "temperature": 0,
    }).encode()

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {OPENAI_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            resp = json.loads(r.read())
            text = resp["choices"][0]["message"]["content"].strip()
            result = json.loads(text)
            return {
                "status": result.get("status", "new"),
                "ai_note": result.get("ai_note", ""),
            }
    except Exception as e:
        print(f"[inbox] classify error: {e}")
        return {"status": "new", "ai_note": ""}


def upsert_lead(tg_id, username, first_name, last_name, phone, text, received_at, classification=None):
    if not tables_ready:
        return False
    data = {
        "tg_id": tg_id,
        "username": username,
        "first_name": first_name,
        "last_name": last_name,
        "phone": phone,
        "last_text": (text or "")[:2000],
        "last_msg_at": received_at,
    }
    if classification:
        data["status"]  = classification["status"]
        data["ai_note"] = classification["ai_note"]
    s, body = supabase_req("POST", "/rest/v1/inbox_leads", data=data, params="?on_conflict=tg_id")
    if s not in (200, 201):
        print(f"[inbox] ⚠️ upsert lead {s}: {body[:120]}")
        return False
    return True


def save_message(lead_tg_id, text, direction, received_at):
    if not tables_ready:
        return
    s, body = supabase_req("POST", "/rest/v1/inbox_messages", data={
        "lead_tg_id": lead_tg_id,
        "text": (text or "")[:2000],
        "direction": direction,
        "received_at": received_at,
    })
    if s not in (200, 201):
        print(f"[inbox] ⚠️ save_message {s}: {body[:120]}")


async def process_message(client, event):
    if not event.is_private:
        return
    sender = await event.get_sender()
    if not sender or not isinstance(sender, User):
        return
    if getattr(sender, "bot", False) or sender.id in SYSTEM_IDS:
        return
    text = event.message.text or ""
    if not text:
        return

    tg_id      = str(sender.id)
    username   = getattr(sender, "username", None)
    first_name = getattr(sender, "first_name", None)
    last_name  = getattr(sender, "last_name", None)
    phone      = getattr(sender, "phone", None)
    received_at = event.message.date.isoformat() if event.message.date else datetime.now(timezone.utc).isoformat()

    print(f"[inbox] 📩 {first_name} (@{username or tg_id}): {text[:60]!r}")

    # Собираем последние сообщения для классификации
    msgs_for_classify = []
    async for msg in client.iter_messages(sender, limit=15):
        if msg.text:
            role = "assistant" if msg.out else "user"
            msgs_for_classify.insert(0, {"role": role, "content": msg.text})

    classification = classify_dialog(msgs_for_classify)
    print(f"[inbox] 🤖 {classification['status']}: {classification['ai_note'][:60]}")

    if not tables_ready:
        check_tables()

    ok = upsert_lead(tg_id, username, first_name, last_name, phone, text, received_at, classification)
    if ok:
        save_message(tg_id, text, "in", received_at)


async def backfill(client):
    if not tables_ready:
        print("[inbox] ⏭ Пропускаю backfill — таблицы не готовы")
        return
    print("[inbox] Сканирую существующие диалоги...")
    count = 0
    async for dialog in client.iter_dialogs(limit=200):
        entity = dialog.entity
        if not isinstance(entity, User):
            continue
        if getattr(entity, "bot", False) or entity.id in SYSTEM_IDS:
            continue

        tg_id      = str(entity.id)
        username   = getattr(entity, "username", None)
        first_name = getattr(entity, "first_name", None)
        last_name  = getattr(entity, "last_name", None)
        phone      = getattr(entity, "phone", None)

        # Собираем все сообщения диалога
        all_msgs = []
        last_in_text = None
        last_in_date = None
        async for msg in client.iter_messages(entity, limit=30):
            if not msg.text:
                continue
            direction = "out" if msg.out else "in"
            received_at = msg.date.isoformat() if msg.date else datetime.now(timezone.utc).isoformat()
            all_msgs.insert(0, {"role": "assistant" if msg.out else "user", "content": msg.text})
            save_message(tg_id, msg.text, direction, received_at)
            if direction == "in" and last_in_text is None:
                last_in_text = msg.text
                last_in_date = received_at

        if last_in_text:
            classification = classify_dialog(all_msgs)
            print(f"[inbox] {first_name} @{username} → {classification['status']}: {classification['ai_note'][:50]}")
            upsert_lead(tg_id, username, first_name, last_name, phone, last_in_text, last_in_date, classification)
        count += 1
        await asyncio.sleep(1)

    print(f"[inbox] ✅ Backfill завершён. Диалогов: {count}")


async def main():
    client = TelegramClient(SESSION, API_ID, API_HASH)

    @client.on(events.NewMessage(incoming=True))
    async def on_new(event):
        await process_message(client, event)

    await client.start()
    me = await client.get_me()
    print(f"[inbox] ✅ Слушаем {me.first_name} +{me.phone}")

    check_tables()
    await backfill(client)
    print("[inbox] 👂 Ждём новых сообщений...")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
