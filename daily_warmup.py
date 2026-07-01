"""
Warmup: все аккаунты параллельно.
- читают ЖК-чаты
- ставят реакции ❤/🔥
- пишут друг другу
Запускается 3 раза в день: morning/afternoon/evening
"""
import asyncio, csv, json, random, sqlite3, sys
from pathlib import Path
from telethon import TelegramClient
from telethon.tl.functions.channels import JoinChannelRequest, GetFullChannelRequest
from telethon.tl.functions.channels import ReadHistoryRequest as ChanReadHistory
from telethon.tl.functions.messages import GetHistoryRequest, SendReactionRequest
from telethon.tl.types import (ReactionEmoji, ChatReactionsSome,
                                ChatReactionsAll, ChatReactionsNone)
from telethon.errors import (UserAlreadyParticipantError, FloodWaitError,
                              ChatWriteForbiddenError)

OUTREACH_DIR = Path("/opt/kitaiservise/outreach")
CHATS_CSV    = Path("/opt/kitaiservise/chats.csv")
DB_PATH      = str(OUTREACH_DIR / "outreach.db")

PREFERRED_REACTIONS = ["❤", "🔥"]

MODE = sys.argv[1] if len(sys.argv) > 1 else "morning"

INTER_MESSAGES = [
    ["Привет! Как дела?", "Всё хорошо) А у тебя?", "Тоже норм, работаю"],
    ["Привет)", "О, привет! Всё ок?", "Да, всё хорошо 😊"],
    ["Добрый день!", "Привет! Как настроение?", "Хорошее, спасибо)"],
    ["Ну как ты?", "Нормально, занята немного", "Понял, не буду отвлекать 😊"],
    ["Эй, привет!", "Привет! Что нового?", "Да ничего особенного"],
]

DB_LOCK = asyncio.Lock()

def log_activity(session: str, type_: str, detail: str = ""):
    for _ in range(5):
        try:
            conn = sqlite3.connect(DB_PATH, timeout=10)
            conn.execute("INSERT INTO activity_log (session, type, detail) VALUES (?,?,?)",
                         (session, type_, detail))
            conn.commit()
            conn.close()
            return
        except sqlite3.OperationalError:
            import time; time.sleep(0.2)

def already_done_today(session: str, type_: str, detail: str = "") -> bool:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    q = "SELECT COUNT(*) FROM activity_log WHERE session=? AND type=? AND detail=? AND date(done_at)=date('now')"
    count = conn.execute(q, (session, type_, detail)).fetchone()[0]
    conn.close()
    return count > 0

def load_handles():
    handles = []
    with open(CHATS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            link = row.get("Ссылка", "").strip()
            if link:
                handles.append(link.replace("https://t.me/", "").strip())
    return handles

def load_accounts():
    return json.loads((OUTREACH_DIR / "accounts.json").read_text())

async def get_allowed_reactions(client, entity) -> list:
    try:
        full = await client(GetFullChannelRequest(entity))
        avail = getattr(full.full_chat, "available_reactions", None)
        if isinstance(avail, ChatReactionsNone):
            return []
        if isinstance(avail, ChatReactionsSome):
            emojis = [r.emoticon for r in avail.reactions if isinstance(r, ReactionEmoji)]
            preferred = [e for e in PREFERRED_REACTIONS if e in emojis]
            return preferred
        return PREFERRED_REACTIONS
    except Exception:
        return PREFERRED_REACTIONS

async def read_and_react(client, session: str, handle: str, name: str):
    if already_done_today(session, "reaction", handle):
        return
    try:
        entity = await client.get_entity(handle)
    except Exception as e:
        print(f"  [{name}] get_entity {handle}: {e}")
        return

    try:
        await client(JoinChannelRequest(entity))
        await asyncio.sleep(random.uniform(3, 8))
    except UserAlreadyParticipantError:
        pass
    except FloodWaitError as e:
        print(f"  [{name}] FloodWait join {e.seconds}с")
        return
    except Exception:
        pass

    try:
        history = await client(GetHistoryRequest(
            peer=entity, limit=50, offset_date=None, offset_id=0,
            max_id=0, min_id=0, add_offset=0, hash=0))
        await client(ChanReadHistory(channel=entity, max_id=0))
        log_activity(session, "chat_read", handle)
        print(f"  [{name}] прочитал {handle}")

        allowed = await get_allowed_reactions(client, entity)
        if not allowed:
            print(f"  [{name}] {handle} реакции отключены")
            return

        reactable = [m for m in history.messages
                     if hasattr(m, 'id') and (getattr(m, 'text', '') or getattr(m, 'media', None))]
        if reactable:
            for msg in random.sample(reactable, min(2, len(reactable))):
                await asyncio.sleep(random.uniform(10, 25))
                emoji = random.choice(allowed)
                try:
                    await client(SendReactionRequest(
                        peer=entity, msg_id=msg.id,
                        reaction=[ReactionEmoji(emoticon=emoji)]))
                    log_activity(session, "reaction", handle)
                    print(f"  [{name}] реакция {emoji} в {handle}")
                except ChatWriteForbiddenError:
                    print(f"  [{name}] {handle} read-only")
                    break
                except FloodWaitError as e:
                    print(f"  [{name}] FloodWait реакция {e.seconds}с")
                    break
                except Exception as e:
                    print(f"  [{name}] реакция ошибка {handle}: {e}")
    except Exception as e:
        print(f"  [{name}] history {handle}: {e}")

async def warmup_one(acc: dict, handles: list) -> tuple:
    session = acc["session"]
    proxy   = acc.get("proxy")
    proxy_arg = tuple(proxy) if proxy else None

    client = TelegramClient(
        str(OUTREACH_DIR / session),
        acc["api_id"], acc["api_hash"],
        proxy=proxy_arg
    )
    try:
        await client.connect()
        me = await client.get_me()
        name = me.first_name or session
        print(f"\n[warmup] {name} старт ({MODE})")

        if MODE in ("morning", "evening"):
            chats = random.sample(handles, min(3, len(handles)))
            tasks = [read_and_react(client, session, h, name) for h in chats]
            await asyncio.gather(*tasks)

        elif MODE == "afternoon":
            chats = random.sample(handles, min(2, len(handles)))
            for handle in chats:
                try:
                    entity = await client.get_entity(handle)
                    await client(ChanReadHistory(channel=entity, max_id=0))
                    log_activity(session, "chat_read", handle)
                    print(f"  [{name}] прочитал {handle}")
                    await asyncio.sleep(random.uniform(5, 15))
                except Exception as e:
                    print(f"  [{name}] {handle}: {e}")

        print(f"[warmup] {name} готов")
        return session, (client, me)
    except Exception as e:
        print(f"[warmup] ошибка {session}: {e}")
        try:
            await client.disconnect()
        except Exception:
            pass
        return session, None

async def send_inter_messages(all_clients: dict):
    sessions = list(all_clients.keys())
    if len(sessions) < 2:
        return

    pairs = [(sessions[i], sessions[j])
             for i in range(len(sessions))
             for j in range(i+1, len(sessions))]
    random.shuffle(pairs)
    pairs = pairs[:4]

    async def chat_pair(s1, s2, index: int):
        if already_done_today(s1, "inter_message", s2):
            return
        # Каждая пара стартует в разное время: 0-20 мин разброс
        delay = random.uniform(index * 60, index * 60 + random.uniform(120, 600))
        print(f"  [chat] пара {index+1} стартует через {delay:.0f}с")
        await asyncio.sleep(delay)

        c1, m1 = all_clients[s1]
        c2, m2 = all_clients[s2]
        # Получаем все аккаунты для поиска телефонов
        accs_map = {a["session"]: a for a in load_accounts()}
        acc2 = accs_map.get(s2, {})
        acc1 = accs_map.get(s1, {})
        # Используем username или номер телефона для резолва
        target_for_c1 = f"@{m2.username}" if m2.username else acc2.get("phone", m2.id)
        target_for_c2 = f"@{m1.username}" if m1.username else acc1.get("phone", m1.id)
        msgs = random.choice(INTER_MESSAGES)
        try:
            await c1.send_message(target_for_c1, msgs[0])
            log_activity(s1, "inter_message", s2)
            print(f"  [chat] {m1.first_name} → {m2.first_name}: {msgs[0]}")
            # Случайная задержка ответа: как живой человек (1-8 мин)
            await asyncio.sleep(random.uniform(60, 480))
            await c2.send_message(target_for_c2, msgs[1])
            log_activity(s2, "inter_reply", s1)
            print(f"  [chat] {m2.first_name} → {m1.first_name}: {msgs[1]}")
            await asyncio.sleep(random.uniform(30, 180))
            await c1.send_message(target_for_c1, msgs[2])
            print(f"  [chat] {m1.first_name} → {m2.first_name}: {msgs[2]}")
        except Exception as e:
            print(f"  [chat] ошибка {m1.first_name}↔{m2.first_name}: {e}")

    await asyncio.gather(*[chat_pair(s1, s2, i) for i, (s1, s2) in enumerate(pairs)])

async def main():
    handles = load_handles()
    accs = load_accounts()
    print(f"[warmup] режим={MODE}, аккаунтов={len(accs)}, чатов={len(handles)}")

    # Все аккаунты параллельно
    results = await asyncio.gather(*[warmup_one(acc, handles) for acc in accs])

    all_clients = {s: r for s, r in results if r is not None}
    print(f"\n[warmup] подключено: {len(all_clients)}/{len(accs)}")

    if MODE in ("morning", "evening") and len(all_clients) >= 2:
        print(f"\n[warmup] === Переписка между аккаунтами ===")
        await send_inter_messages(all_clients)

    for client, _ in all_clients.values():
        try:
            await client.disconnect()
        except Exception:
            pass

    print(f"\n[warmup] готово ({MODE})")

asyncio.run(main())
