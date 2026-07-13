"""
KitaiService Manager Daemon
Запуск: python3 manager_daemon.py --group 0|1|2
  --group 0  → аккаунты группы A (hash % 3 == 0)
  --group 1  → аккаунты группы B (hash % 3 == 1)
  --group 2  → аккаунты группы C (hash % 3 == 2)
  (без --group → все аккаунты, legacy режим)

Расписание МСК:
  09:00 — warmup morning: чаты + реакции + переписка между собой
  14:00 — warmup afternoon: только читаем чаты
  19:00 — warmup evening:  чаты + реакции + переписка между собой
  11:00 — рассылка: отправка сообщений лидам (активные аккаунты)
"""
import asyncio, csv, hashlib, json, logging, os, random, signal, sqlite3, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Грузим .env если есть
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from telethon import TelegramClient, events
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.account import UpdateStatusRequest
from telethon.tl.functions.channels import ReadHistoryRequest as ChanReadHistory
from telethon.tl.functions.messages import GetHistoryRequest, SendReactionRequest, SetTypingRequest
from telethon.tl.types import SendMessageTypingAction, SendMessageCancelAction
from telethon.tl.types import ReactionEmoji, ChatReactionsSome, ChatReactionsNone
from telethon.errors import (UserAlreadyParticipantError, FloodWaitError,
                              ChatWriteForbiddenError, UserPrivacyRestrictedError,
                              UserIsBlockedError, InputUserDeactivatedError,
                              UsernameNotOccupiedError, UsernameInvalidError,
                              PeerFloodError, AuthKeyDuplicatedError,
                              UserDeactivatedBanError, AuthKeyUnregisteredError)

# ── Группа аккаунтов (--group 0/1/2) ─────────────────────────────────────────
def _stable_group(session: str) -> int:
    """Детерминированный номер группы — не зависит от PYTHONHASHSEED."""
    return int(hashlib.md5(session.encode()).hexdigest(), 16) % 3

_GROUP: int | None = None
_GROUP_LETTER = ""
for _i, _arg in enumerate(sys.argv):
    if _arg == "--group" and _i + 1 < len(sys.argv):
        _GROUP = int(sys.argv[_i + 1])
        _GROUP_LETTER = "abc"[_GROUP]
        break

# ── Пути ──────────────────────────────────────────────────────────────────────
# По умолчанию — рядом со скриптом; на сервере переопределяется через .env (OUTREACH_DIR=/opt/kitaiservice_outreach).
OUTREACH_DIR = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent)
DB_PATH      = str(OUTREACH_DIR / "outreach.db")
BLACKLIST_FILE = OUTREACH_DIR / "chat_blacklist.txt"

if _GROUP is not None:
    _GROUP_DIR   = OUTREACH_DIR / f"groups/group_{_GROUP_LETTER}"
    CHATS_CSV    = _GROUP_DIR / "chats.csv"
    MSG_FILE     = _GROUP_DIR / "messages" / "message.txt"
    MESSAGES_DIR = _GROUP_DIR / "messages"
    PID_FILE     = _GROUP_DIR / "daemon.pid"
    _LOG_FILE    = _GROUP_DIR / "daemon.log"
else:
    CHATS_CSV    = OUTREACH_DIR / "chats.csv"
    MSG_FILE     = OUTREACH_DIR / "message.txt"
    MESSAGES_DIR = OUTREACH_DIR / "messages"
    PID_FILE     = OUTREACH_DIR / "daemon.pid"
    _LOG_FILE    = OUTREACH_DIR / "daemon.log"

MSK = timezone(timedelta(hours=3))

# ── Логгер ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(str(_LOG_FILE)),
    ]
)
log = logging.getLogger("daemon")

# ── Константы ─────────────────────────────────────────────────────────────────

DAILY_LIMIT  = 4
HOURLY_LIMIT = 1
DELAY_MIN    = 120.0
DELAY_MAX    = 300.0
SEND_HOUR_START = 11
SEND_HOUR_END   = 21

INTER_MESSAGES = [
    ["Привет! Как дела?", "Всё хорошо) А у тебя?", "Тоже норм, работаю"],
    ["Привет)", "О, привет! Всё ок?", "Да, всё хорошо 😊"],
    ["Добрый день!", "Привет! Как настроение?", "Хорошее, спасибо)"],
    ["Ну как ты?", "Нормально, занята немного", "Понял, не буду отвлекать 😊"],
    ["Эй, привет!", "Привет! Что нового?", "Да ничего особенного"],
    ["Как работа?", "Нормально, потихоньку 😊", "Ну и хорошо)"],
    ["Привет, всё ок?", "Да, всё нормально, а ты?", "Тоже всё ок, работаю"],
    ["Привет, что делаешь?", "Да так, по дому", "Понятно) у меня тоже"],
    ["ку", "ку) всё норм?", "да, ты как?"],
    ["Привет! Ты дома?", "Да, а что?", "Ничего просто так 😄"],
    ["Доброе утро!", "Привет! Уже проснулась?", "Да, давно уже 😄"],
    ["Как настроение сегодня?", "Нормальное) А у тебя?", "Тоже ок, погода хорошая"],
    ["Что делаешь?", "Да ничего особенного, отдыхаю", "Понятно, и я так же 😊"],
    ["Привет! Давно не писала", "Привет! Да всё дела были", "Понятно, ну как ты вообще?"],
    ["эй", "да?", "просто написала 😄"],
    ["Ты как?", "Норм) занята немного", "Ок, не буду мешать"],
    ["Привет! Как дела на работе?", "Нормально, всё хорошо", "Отлично 👍"],
    ["Добрый вечер!", "Привет! Как день прошёл?", "Неплохо, устала немного"],
    ["Привет) скучно что-то", "Привет 😄 у меня тоже", "Может поболтаем)"],
    ["Как ты?", "Хорошо, спасибо ❤ а ты?", "Тоже всё норм, слава богу"],
    ["Привет! Что нового?", "Да ничего особого", "И у меня тихо 😊"],
    ["Ку! Давно не общались", "Ку) да, всё как-то некогда было", "Понимаю, и у меня так"],
    ["Привет, ты где?", "Дома, а что?", "Да просто интересно 😄"],
    ["Доброе утро 🌸", "Доброе! Как спалось?", "Хорошо, спасибо)"],
    ["Привет! Как ты вообще?", "Нормально) всё ок. ты как?", "Тоже хорошо, потихоньку"],
    # Расширенный пул — снижает вероятность повтора одного opener
    ["Привет, не отвлекаю?", "Нет-нет, всё ок)", "Окей, просто так написала"],
    ["Слушай, как ты?", "Да норм в целом, а ты?", "Тоже ок, работы много"],
    ["О, привет!", "Привет! Давно не виделись 😄", "Ну да, всё дела..."],
    ["Как жизнь?", "Да ничего, потихоньку)", "И у меня так же"],
    ["Здарова", "О, привет! Как ты?", "Норм, работаю вот"],
    ["Привет! Не спишь?", "Нет, сижу дома", "Понятно, и я дома"],
    ["Ты сейчас занята?", "Немного, а что?", "Да нет, просто написала)"],
    ["Добрый! Как твои дела?", "Всё хорошо, спасибо! А у тебя?", "Тоже норм 👌"],
    ["Привет, соскучилась)", "Аа привет! Я тоже 😄", "Надо как-нибудь созвониться"],
    ["Ну что, как дела?", "Норм, устала немного", "О, понимаю. Отдыхай)"],
    ["Привет! Чем занимаешься?", "Да так, по дому всё", "Понятно) у меня то же самое"],
    ["Эй, живая?", "Да, живая 😄 Что случилось?", "Ничего, просто проверила"],
    ["Привет! Хорошего дня тебе)", "Спасибо! И тебе тоже 🌸", "Взаимно)"],
    ["Как сегодня?", "Нормально) А у тебя?", "Тоже неплохо, занята"],
    ["Привет! Давно хотела написать", "О, привет! Как ты вообще?", "Всё хорошо, работаю"],
    ["Ку) что делаешь?", "Да ничего, отдыхаю", "Хорошо отдыхай 😊"],
    ["Привет! Ты в порядке?", "Да всё норм, спасибо)", "Ну и хорошо 👍"],
    ["Написала просто так)", "Ааа привет! Рада)", "Я тоже 😄"],
    ["Добрый вечер! Как день?", "День был нормальный, устала чуть", "Отдыхай тогда)"],
    ["Привет! Как настроение?", "Хорошее в целом 😊 А у тебя?", "Тоже норм, работаю"],
    ["Слушай, давно не писали", "Ну да, всё некогда как-то", "Понимаю, у меня то же"],
    ["Привет! Не мёрзнешь?", "Нет, дома тепло 😄", "Вот и хорошо)"],
    ["Ты как там?", "Да ничего, норм)", "Ну и ладно, работай)"],
    ["Привет! Чё делаешь?", "Сижу, отдыхаю немного", "Хорошее дело 😊"],
    ["Эй! Как жизнь?", "Да нормально, ты как?", "Тоже всё хорошо)"],
    ["Привет, не скучаешь?", "Немного 😄 А ты?", "И я тоже, работы много"],
]

# ── Константы прогрева ────────────────────────────────────────────────────────
PREFERRED_REACTIONS   = ["❤", "🔥", "👍", "😍", "👏", "🎉", "💯"]
MAX_REACTIONS_PER_DAY = 4
REACTION_CHANCE       = 0.25   # 25% вероятность реакции после чтения
SKIP_SESSION_CHANCE   = 0.12   # 12% — иногда пропускаем сессию


# ── Telegram алерты ───────────────────────────────────────────────────────────
ALERT_BOT_TOKEN = os.environ.get("ALERT_BOT_TOKEN", "")
ALERT_USER_ID   = os.environ.get("ALERT_USER_ID", "")

def tg_alert(text: str):
    """Отправляет алерт владельцу в Telegram."""
    if not ALERT_BOT_TOKEN or not ALERT_USER_ID:
        return
    import urllib.request, urllib.error
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{ALERT_BOT_TOKEN}/sendMessage",
            data=json.dumps({"chat_id": ALERT_USER_ID, "text": text, "parse_mode": "HTML"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST"
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log.warning(f"[alert] не могу отправить: {e}")

# ── Состояние ─────────────────────────────────────────────────────────────────
clients: dict[str, tuple[TelegramClient, object]] = {}  # session → (client, me)
acc_clients: dict[int, TelegramClient] = {}             # account_id → client (для operator бота)
accs_map: dict[str, dict] = {}
running = True
bad_auth_sessions: set[str] = set()  # сессии с AuthKeyDuplicatedError — reconnect_loop их пропускает
proxy_overrides: dict[str, list | None] = {}  # session → резервный прокси (None = direct)
_sender_running: bool = False  # защита от двойного запуска сендера
_inter_chat_running: bool = False  # защита от двойного запуска inter_chat

# ── Incoming + Operator ────────────────────────────────────────────────────────
edit_waiting: dict[int, dict] = {}   # conv_id → {"msg_id": int, "at": isoformat}


def _db_get_contact_by_tg_id(tg_id: str) -> dict | None:
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        row = c.execute("SELECT * FROM contacts WHERE tg_id=?", (tg_id,)).fetchone()
        c.close()
        return dict(row) if row else None
    except Exception:
        return None


def _db_get_conversation(conv_id: int) -> dict | None:
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        row = c.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
        c.close()
        return dict(row) if row else None
    except Exception:
        return None


def _db_get_contact(contact_id: int) -> dict | None:
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        row = c.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)).fetchone()
        c.close()
        return dict(row) if row else None
    except Exception:
        return None


def _db_get_our_message(contact_id: int) -> str:
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        row = c.execute(
            "SELECT text FROM messages WHERE contact_id=? AND direction='out' ORDER BY id DESC LIMIT 1",
            (contact_id,)
        ).fetchone()
        c.close()
        return row["text"] if row else ""
    except Exception:
        return ""


def _db_get_history(contact_id: int) -> list[dict]:
    """Вся переписка с контактом в хронологическом порядке (для AI-контекста)."""
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        rows = c.execute(
            "SELECT direction, text, sent_at FROM messages WHERE contact_id=? ORDER BY id ASC",
            (contact_id,)
        ).fetchall()
        c.close()
        return [dict(r) for r in rows]
    except Exception:
        return []



def _db_close_conversation(conv_id: int):
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.execute("UPDATE conversations SET status='closed', updated_at=datetime('now') WHERE id=?", (conv_id,))
        c.commit()
        c.close()
    except Exception as e:
        log.warning(f"[incoming] close_conv error: {e}")


def _db_upsert_conversation(contact_id: int, account_id: int, ai_draft: str = "") -> int:
    try:
        c = sqlite3.connect(DB_PATH, timeout=25)
        c.row_factory = sqlite3.Row
        row = c.execute("SELECT id FROM conversations WHERE contact_id=?", (contact_id,)).fetchone()
        if row:
            c.execute("UPDATE conversations SET ai_draft=?, updated_at=datetime('now') WHERE id=?",
                      (ai_draft, row["id"]))
            c.commit()
            cid = row["id"]
        else:
            cur = c.execute(
                "INSERT INTO conversations (contact_id, account_id, ai_draft) VALUES (?,?,?)",
                (contact_id, account_id, ai_draft)
            )
            c.commit()
            cid = cur.lastrowid
        c.close()
        return cid
    except Exception as e:
        log.warning(f"[incoming] upsert_conv error: {e}")
        return 0


async def handle_incoming(client: TelegramClient, account_id: int, me, event):
    """Обрабатывает входящее личное сообщение от лида."""
    if not event.is_private:
        return
    try:
        sender = await event.get_sender()
        if not sender:
            return
        tg_id = str(sender.id)
        if me and str(me.id) == tg_id:
            return
        contact = _db_get_contact_by_tg_id(tg_id)
        if not contact or contact["status"] not in ("sent", "replied"):
            return
        text = event.message.text or ""
        if not text:
            return
        username = getattr(sender, "username", None)
        manager_name  = getattr(me, "first_name", None) if me else None
        manager_phone = getattr(me, "phone", None) if me else None
        log.info(f"[incoming] ответ от @{username} ({tg_id}): {text[:60]!r}")
        db_log(f"acc_{account_id}", "incoming", f"from={tg_id}")
        # Отмечаем сообщение прочитанным
        try:
            await event.mark_read()
        except Exception:
            pass
        # Сохраняем сообщение
        for _ in range(5):
            try:
                c = sqlite3.connect(DB_PATH, timeout=25)
                c.execute(
                    "INSERT INTO messages (contact_id, account_id, direction, text, tg_msg_id) VALUES (?,?,?,?,?)",
                    (contact["id"], account_id, "in", text, event.message.id)
                )
                c.commit()
                c.close()
                break
            except sqlite3.OperationalError:
                await asyncio.sleep(0.3)
        # Статус контакта → replied
        try:
            c = sqlite3.connect(DB_PATH, timeout=25)
            c.execute(
                "UPDATE contacts SET status='replied', replied_at=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), contact["id"])
            )
            c.commit()
            c.close()
        except Exception as e:
            log.warning(f"[incoming] mark replied error: {e}")
        # AI черновик
        our_msg = _db_get_our_message(contact["id"])
        history = _db_get_history(contact["id"])
        draft = ""
        try:
            from ai import generate_draft
            draft = await asyncio.to_thread(generate_draft, history, manager_name or "")
        except Exception as e:
            log.warning(f"[incoming] AI error: {e}")
        conv_id = _db_upsert_conversation(contact["id"], account_id, draft)
        # Уведомление оператора
        try:
            from operator_bot import notify_reply
            await asyncio.to_thread(
                notify_reply, conv_id, username, tg_id, our_msg, text, draft,
                manager_name, manager_phone
            )
        except Exception as e:
            log.warning(f"[incoming] notify error: {e}")
    except Exception as e:
        log.warning(f"[incoming] handler error: {e}")


async def poll_operator():
    """Опрашивает operator-бота и обрабатывает команды send/edit/skip."""
    try:
        from operator_bot import bot_api, get_updates, answer_cb, remove_buttons, notify_sent
        operator_ids = [int(x) for x in os.environ.get("OPERATOR_USER_ID", "").split(",") if x.strip()]
        if not operator_ids:
            log.warning("[operator] OPERATOR_USER_ID не задан — poll отключён")
            return
    except Exception as e:
        log.warning(f"[operator] init error: {e}")
        return

    update_offset = 0
    log.info(f"[operator] poll запущен (operator_ids={operator_ids})")
    while running:
        try:
            updates = await asyncio.to_thread(get_updates, update_offset)
            for upd in updates:
                update_offset = upd["update_id"] + 1
                msg = upd.get("message")
                if msg and msg.get("from", {}).get("id") in operator_ids:
                    sender_chat_id = msg["chat"]["id"]
                    text = msg.get("text", "").strip()
                    if text in ("/cancel", "/отмена"):
                        edit_waiting.clear()
                        await asyncio.to_thread(bot_api, "sendMessage",
                                                {"chat_id": sender_chat_id, "text": "❌ Редактирование отменено"})
                        continue
                    if text.startswith("/"):
                        continue
                    for conv_id, info in list(edit_waiting.items()):
                        if datetime.now() - datetime.fromisoformat(info["at"]) > timedelta(minutes=5):
                            del edit_waiting[conv_id]
                            continue
                        conv = _db_get_conversation(conv_id)
                        if not conv:
                            del edit_waiting[conv_id]
                            continue
                        try:
                            c = sqlite3.connect(DB_PATH, timeout=20)
                            c.execute("UPDATE conversations SET ai_draft=?, updated_at=datetime('now') WHERE id=?",
                                      (text, conv_id))
                            c.commit()
                            c.close()
                        except Exception as _e:
                            log.warning(f"[operator] update draft: {_e}")
                        del edit_waiting[conv_id]
                        await asyncio.to_thread(bot_api, "sendMessage", {
                            "chat_id": sender_chat_id,
                            "text": f"✅ Обновлено. Отправить?\n\n{text}",
                            "reply_markup": {"inline_keyboard": [[
                                {"text": "✅ Отправить",  "callback_data": f"send:{conv_id}"},
                                {"text": "❌ Пропустить", "callback_data": f"skip:{conv_id}"},
                            ]]},
                        })
                        break

                cb = upd.get("callback_query")
                if not cb or cb.get("from", {}).get("id") not in operator_ids:
                    continue
                data       = cb.get("data", "")
                cb_id      = cb["id"]
                msg_id     = cb.get("message", {}).get("message_id", 0)
                cb_chat_id = cb.get("message", {}).get("chat", {}).get("id", 0)

                if data.startswith("send:"):
                    conv_id  = int(data[len("send:"):])
                    conv     = _db_get_conversation(conv_id)
                    if not conv:
                        await asyncio.to_thread(answer_cb, cb_id, "Не найдено")
                        continue
                    contact  = _db_get_contact(conv["contact_id"])
                    draft    = conv.get("ai_draft", "")
                    acc_cl   = acc_clients.get(conv["account_id"])
                    if not acc_cl:
                        # Аккаунт в другой группе — ставим в очередь
                        try:
                            _qc = sqlite3.connect(DB_PATH, timeout=20)
                            _qc.execute(
                                "INSERT INTO pending_operator_sends (conv_id) VALUES (?)",
                                (conv_id,)
                            )
                            _qc.commit()
                            _qc.close()
                            await asyncio.to_thread(answer_cb, cb_id, "⏳ Отправляем...")
                        except Exception as _qe:
                            await asyncio.to_thread(answer_cb, cb_id, f"Ошибка очереди: {_qe}")
                        continue
                    target = f"@{contact['username']}" if contact and contact.get("username") else int(contact["tg_id"])
                    try:
                        sent_msg = await acc_cl.send_message(target, draft)
                        for _ in range(5):
                            try:
                                c = sqlite3.connect(DB_PATH, timeout=25)
                                c.execute(
                                    "INSERT INTO messages (contact_id, account_id, direction, text, tg_msg_id) VALUES (?,?,?,?,?)",
                                    (conv["contact_id"], conv["account_id"], "out", draft, sent_msg.id)
                                )
                                c.commit()
                                c.close()
                                break
                            except sqlite3.OperationalError:
                                await asyncio.sleep(0.3)
                        _db_close_conversation(conv_id)
                        await asyncio.to_thread(answer_cb, cb_id, "✅ Отправлено")
                        await asyncio.to_thread(remove_buttons, msg_id, cb_chat_id)
                        if contact:
                            await asyncio.to_thread(notify_sent, contact.get("username"), contact["tg_id"], draft)
                    except Exception as e:
                        await asyncio.to_thread(answer_cb, cb_id, f"Ошибка: {e}")
                        log.warning(f"[operator] send error: {e}")

                elif data.startswith("skip:"):
                    conv_id = int(data[len("skip:"):])
                    conv    = _db_get_conversation(conv_id)
                    if conv:
                        try:
                            c = sqlite3.connect(DB_PATH, timeout=20)
                            c.execute("UPDATE contacts SET status='skipped' WHERE id=?", (conv["contact_id"],))
                            c.commit()
                            c.close()
                        except Exception:
                            pass
                    _db_close_conversation(conv_id)
                    await asyncio.to_thread(answer_cb, cb_id, "⛔ В блэклист")
                    await asyncio.to_thread(remove_buttons, msg_id, cb_chat_id)

                elif data.startswith("edit:"):
                    conv_id = int(data[len("edit:"):])
                    edit_waiting[conv_id] = {"at": datetime.now().isoformat(), "msg_id": msg_id}
                    await asyncio.to_thread(answer_cb, cb_id, "Напиши новый вариант ответа")
                    await asyncio.to_thread(bot_api, "sendMessage", {
                        "chat_id": cb_chat_id,
                        "text": "✏️ Напиши новый вариант ответа:",
                    })
        except Exception as e:
            log.debug(f"[operator] poll error: {e}")
        await asyncio.sleep(3)


async def poll_pending_sends():
    """Все группы: выполняют отложенные отправки оператора для своих аккаунтов."""
    from operator_bot import notify_sent
    while running:
        try:
            c = sqlite3.connect(DB_PATH, timeout=20)
            c.row_factory = sqlite3.Row
            rows = c.execute(
                "SELECT * FROM pending_operator_sends WHERE status='pending' ORDER BY id"
            ).fetchall()
            c.close()
            for row in rows:
                pend_id = row["id"]
                conv_id = row["conv_id"]
                conv    = _db_get_conversation(conv_id)
                if not conv:
                    _db_mark_pending_send(pend_id, "failed")
                    continue
                acc_cl = acc_clients.get(conv["account_id"])
                if not acc_cl:
                    continue  # не наш аккаунт, пропускаем
                contact = _db_get_contact(conv["contact_id"])
                draft   = conv.get("ai_draft", "")
                target  = f"@{contact['username']}" if contact and contact.get("username") else int(contact["tg_id"])
                try:
                    sent_msg = await acc_cl.send_message(target, draft)
                    _c2 = sqlite3.connect(DB_PATH, timeout=25)
                    _c2.execute(
                        "INSERT INTO messages (contact_id, account_id, direction, text, tg_msg_id) VALUES (?,?,?,?,?)",
                        (conv["contact_id"], conv["account_id"], "out", draft, sent_msg.id)
                    )
                    _c2.commit()
                    _c2.close()
                    _db_close_conversation(conv_id)
                    _db_mark_pending_send(pend_id, "done")
                    if contact:
                        await asyncio.to_thread(notify_sent, contact.get("username"), contact["tg_id"], draft)
                    log.info(f"[pending_send] ✅ conv={conv_id} → {target}")
                except Exception as e:
                    _db_mark_pending_send(pend_id, "failed")
                    log.warning(f"[pending_send] ❌ conv={conv_id}: {e}")
        except Exception as e:
            log.debug(f"[pending_send] poll error: {e}")
        await asyncio.sleep(5)


def _db_mark_pending_send(pend_id: int, status: str):
    try:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.execute("UPDATE pending_operator_sends SET status=? WHERE id=?", (status, pend_id))
        c.commit()
        c.close()
    except Exception as e:
        log.warning(f"[pending_send] mark error: {e}")


# ── DB хелперы ────────────────────────────────────────────────────────────────
def db_log(session: str, type_: str, detail: str = ""):
    for _ in range(10):
        try:
            conn = sqlite3.connect(DB_PATH, timeout=25)
            conn.execute("INSERT INTO activity_log (session,type,detail) VALUES (?,?,?)",
                         (session, type_, detail))
            conn.commit()
            conn.close()
            return
        except sqlite3.OperationalError:
            import time; time.sleep(0.3)

def done_today(session: str, type_: str, detail: str = "") -> bool:
    conn = sqlite3.connect(DB_PATH, timeout=25)
    r = conn.execute(
        "SELECT COUNT(*) FROM activity_log WHERE session=? AND type=? AND detail=? AND date(done_at)=date('now')",
        (session, type_, detail)).fetchone()[0]
    conn.close()
    return r > 0


def reactions_today_count(session: str) -> int:
    """Сколько реакций аккаунт уже поставил сегодня."""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        count = conn.execute(
            "SELECT COUNT(*) FROM activity_log WHERE session=? AND type='reaction' AND date(done_at)=date('now')",
            (session,)
        ).fetchone()[0]
        conn.close()
        return count
    except Exception:
        return 0

def personal_handles_for(session: str, all_handles: list, n: int) -> list:
    """Выбирает личный набор чатов для аккаунта на сегодня.

    60% из «любимых» чатов аккаунта (стабильны для аккаунта, уникальны между аккаунтами).
    40% — случайные из оставшихся (меняются каждый день).
    Это ломает паттерн «26 аккаунтов читают одни и те же чаты».
    """
    from datetime import date as _date
    if not all_handles:
        return []

    # Стабильный shuffled pool для аккаунта — его «любимые» чаты
    affinity_rng = random.Random(hash(session) & 0xFFFFFFFF)
    affinity_pool = all_handles[:]
    affinity_rng.shuffle(affinity_pool)
    affinity_size = max(5, len(affinity_pool) // 3)
    affinity_chats = affinity_pool[:affinity_size]

    # Ежедневная случайная добавка из остатка
    today_seed = int(_date.today().strftime("%Y%m%d"))
    daily_rng = random.Random((hash(session) ^ today_seed) & 0xFFFFFFFF)
    rest = [c for c in all_handles if c not in set(affinity_chats)]
    daily_rng.shuffle(rest)

    n_affinity = max(1, round(n * 0.6))
    n_random   = n - n_affinity

    chosen = affinity_rng.sample(affinity_chats, min(n_affinity, len(affinity_chats)))
    chosen += rest[:n_random]

    # Финальный shuffle чтобы порядок не был предсказуемым
    random.shuffle(chosen)
    count = random.randint(max(2, n - 2), n + 3)
    return chosen[:min(count, len(chosen))]

def sent_today(account_id: int) -> int:
    conn = sqlite3.connect(DB_PATH, timeout=25)
    r = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE account_id=? AND direction='out' AND date(sent_at)=date('now')",
        (account_id,)).fetchone()[0]
    conn.close()
    return r

def sent_this_hour(account_id: int) -> int:
    conn = sqlite3.connect(DB_PATH, timeout=25)
    r = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE account_id=? AND direction='out' AND sent_at >= datetime('now','-1 hour')",
        (account_id,)).fetchone()[0]
    conn.close()
    return r

# ── Загрузка данных ───────────────────────────────────────────────────────────
def load_handles() -> list[str]:
    blacklist = []
    if BLACKLIST_FILE.exists():
        blacklist = [l.strip().lower() for l in BLACKLIST_FILE.read_text().splitlines() if l.strip() and not l.startswith("#")]

    handles = []
    with open(CHATS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            link = row.get("Ссылка", "").strip()
            if not link:
                continue
            handle = link.replace("https://t.me/", "").strip()
            if blacklist and any(kw in handle.lower() for kw in blacklist):
                continue
            handles.append(handle)
    return handles

def now_msk() -> datetime:
    return datetime.now(MSK)

# ── Реакции ───────────────────────────────────────────────────────────────────
async def get_allowed_reactions(client, entity) -> list:
    try:
        full = await client(GetFullChannelRequest(entity))
        avail = getattr(full.full_chat, "available_reactions", None)
        if isinstance(avail, ChatReactionsNone):
            return []
        if isinstance(avail, ChatReactionsSome):
            emojis = [r.emoticon for r in avail.reactions if isinstance(r, ReactionEmoji)]
            return [e for e in PREFERRED_REACTIONS if e in emojis]
        return PREFERRED_REACTIONS
    except Exception:
        return PREFERRED_REACTIONS

async def read_and_react(session: str, handle: str):
    if session not in clients:
        return
    client, me = clients[session]
    name = me.first_name or session

    if done_today(session, "reaction", handle):
        return
    try:
        entity = await client.get_entity(handle)
    except Exception as e:
        log.debug(f"[{name}] get_entity {handle}: {e}")
        return

    try:
        from telethon.tl.functions.channels import JoinChannelRequest
        await client(JoinChannelRequest(entity))
        await asyncio.sleep(random.uniform(2, 6))
    except (UserAlreadyParticipantError, Exception):
        pass

    try:
        history = await client(GetHistoryRequest(
            peer=entity, limit=50, offset_date=None, offset_id=0,
            max_id=0, min_id=0, add_offset=0, hash=0))
        await client(ChanReadHistory(channel=entity, max_id=0))
        db_log(session, "chat_read", handle)
        log.info(f"  [{name}] прочитал {handle}")

        # Реагируем только с вероятностью 25% и если не превышен дневной лимит
        if random.random() > REACTION_CHANCE:
            return
        if reactions_today_count(session) >= MAX_REACTIONS_PER_DAY:
            return

        allowed = await get_allowed_reactions(client, entity)
        if not allowed:
            return

        # Только свежие сообщения (не старше 15 минут) — реакция на старые выглядит как бот
        fresh_cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
        reactable = [m for m in history.messages
                     if hasattr(m, 'id')
                     and (getattr(m, 'text', '') or getattr(m, 'media', None))
                     and getattr(m, 'date', None) and m.date > fresh_cutoff]
        if not reactable:
            log.debug(f"  [{name}] нет свежих сообщений для реакции в {handle}")
            return

        # Ждём как живой человек — 2-8 минут после прочтения
        await asyncio.sleep(random.uniform(120, 480))

        msg = random.choice(reactable)
        emoji = random.choice(allowed)
        try:
            await client(SendReactionRequest(peer=entity, msg_id=msg.id,
                                              reaction=[ReactionEmoji(emoticon=emoji)]))
            db_log(session, "reaction", handle)
            log.info(f"  [{name}] реакция {emoji} → {handle}")
        except ChatWriteForbiddenError:
            pass
        except FloodWaitError as e:
            await asyncio.sleep(e.seconds)
        except Exception as e:
            log.debug(f"  [{name}] реакция {handle}: {e}")
    except Exception as e:
        log.debug(f"  [{name}] history {handle}: {e}")

# ── Тиры аккаунтов ────────────────────────────────────────────────────────────
# (dm_limit, delay_min, delay_max, warmup_chats, can_send)
# Прогрессия по возрасту аккаунта:
#   new    1-2  дней  → 0/день (только прогрев)
#   blue   3-7  дней  → 3/день
#   green  8-14 дней  → 5/день
#   orange 15-21 дней → 7/день
#   purple 22+  дней  → 10/день
TIER_RULES = {
    'new':    (0,    None, None,  0, False),  # дни 1-2: полная тишина
    'blue':   (3,    300, 480,  20, True),    # дни 3-7: 3/день
    'green':  (5,    240, 420,  30, True),    # дни 8-14: 5/день
    'orange': (7,    180, 360,  30, True),    # дни 15-21: 7/день
    'purple': (10,   120, 300,  30, True),    # дни 22+: 10/день
    'yellow': (2,    480, 720,  15, True),    # ≤24ч после флуда: 2/день
    'red':    (0,    None, None, 20, False),  # флуд-вейт активен
    'black':  (0,    None, None,  0, False),  # dead
}

def compute_daily_limit(session: str, tier: str) -> int:
    """Рандомизированный дневной лимит — стабильный в течение дня, разный каждый день."""
    from datetime import date as _date
    _ranges = {
        'new':    (0, 0),
        'blue':   (2, 4),
        'green':  (4, 6),
        'orange': (6, 8),
        'purple': (8, 10),
        'yellow': (0, 1),
        'red':    (0, 0),
        'black':  (0, 0),
    }
    lo, hi = _ranges.get(tier, (3, 5))
    if lo == hi:
        return lo
    today = int(_date.today().strftime("%Y%m%d"))
    stable = int(hashlib.md5(session.encode()).hexdigest(), 16)
    rng = random.Random((stable ^ today) & 0xFFFFFFFF)
    return rng.randint(lo, hi)


def get_account_tier(session: str) -> str:
    """black=dead, red=paused+active, yellow=paused<24h ago, blue=new<7d, green=ok"""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        row = conn.execute(
            "SELECT status, paused_until, created_at FROM accounts WHERE session=?",
            (session,)).fetchone()
        conn.close()
    except Exception:
        return 'green'
    if not row:
        return 'green'
    status, paused_until, created_at = row
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

            if age <= 2:
                return 'new'
            elif age <= 7:
                return 'blue'
            elif age <= 14:
                return 'green'
            elif age <= 21:
                return 'orange'
            else:
                return 'purple'
        except Exception:
            pass
    return 'purple'

# ── Автоапгрейд аккаунтов ─────────────────────────────────────────────────────
async def task_upgrade_accounts():
    """Каждый день повышает daily_limit с 0 → 3 для аккаунтов старше 3 дней."""
    accounts_file = OUTREACH_DIR / "accounts.json"
    accs = json.loads(accounts_file.read_text())
    now = datetime.now(timezone.utc)
    upgraded = []

    for acc in accs:
        if acc.get("daily_limit", 0) != 0:
            continue
        session = acc["session"]
        if _GROUP is not None and _stable_group(session) != _GROUP:
            continue  # чужой аккаунт — апгрейдит его тот процесс, которому он принадлежит
        try:
            conn = sqlite3.connect(DB_PATH, timeout=20)
            row = conn.execute(
                "SELECT status, created_at FROM accounts WHERE session=?", (session,)
            ).fetchone()
            conn.close()
        except Exception:
            continue
        if not row:
            continue
        status, created_at = row
        if status == "dead":
            continue
        try:
            ca = datetime.fromisoformat(str(created_at))
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            age_days = (now.date() - ca.date()).days + 1
        except Exception:
            continue
        if age_days >= 3:
            acc["daily_limit"] = 3
            accs_map[session] = acc
            upgraded.append(f"{session} (возраст {age_days} дн.)")
            log.info(f"[upgrade] {session}: daily_limit 0 → 3 (возраст {age_days} дн.)")

    # Автовключение sender=true — иначе после ручного онбординга партии аккаунтов
    # легко забыть перевести их из "только прогрев" в реальную рассылку.
    sender_enabled = []
    for acc in accs:
        if acc.get("sender"):
            continue
        session = acc["session"]
        if _GROUP is not None and _stable_group(session) != _GROUP:
            continue
        try:
            conn = sqlite3.connect(DB_PATH, timeout=20)
            row = conn.execute(
                "SELECT status, created_at, flood_count FROM accounts WHERE session=?", (session,)
            ).fetchone()
            conn.close()
        except Exception:
            continue
        if not row:
            continue
        status, created_at, flood_count = row
        if status in ("dead", "auth_error", "paused"):
            continue  # мёртвых и тех, кто сейчас реально в паузе после флуда — не трогаем
        # История флуда сама по себе не блокирует: тир (yellow/red) уже ограничивает
        # лимит и включает can_send, пока пауза не закончится — отдельная ручная
        # проверка тут больше не нужна.
        try:
            ca = datetime.fromisoformat(str(created_at))
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            age_days = (now.date() - ca.date()).days + 1
        except Exception:
            continue
        if age_days >= 3:
            acc["sender"] = True
            accs_map[session] = acc
            sender_enabled.append(f"{session} (возраст {age_days} дн., без флуда)")
            log.info(f"[upgrade] {session}: sender false → true (возраст {age_days} дн.)")

    if sender_enabled:
        upgraded.extend(sender_enabled)

    if upgraded:
        accounts_file.write_text(json.dumps(accs, ensure_ascii=False, indent=2))
        tg_alert("🆙 <b>Автоапгрейд аккаунтов:</b>\n" + "\n".join(f"• {u}" for u in upgraded))
        log.info(f"[upgrade] апгрейд выполнен: {len(upgraded)} аккаунтов")
    else:
        log.info("[upgrade] нет аккаунтов для апгрейда")


# ── Warmup ────────────────────────────────────────────────────────────────────
def _get_account_age(session: str) -> int:
    """Возраст аккаунта в днях (1 = первый день)."""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        row = conn.execute("SELECT created_at FROM accounts WHERE session=?", (session,)).fetchone()
        conn.close()
        if row and row[0]:
            ca = datetime.fromisoformat(str(row[0]))
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc).date() - ca.date()).days + 1
    except Exception:
        pass
    return 99


async def task_warmup(mode: str):
    log.info(f"=== Warmup {mode} ===")
    handles = load_handles()

    async def warmup_one(session):
        if session not in clients:
            return
        client, me = clients[session]
        name = me.first_name or session

        # Случайный сдвиг старта: 5-45 мин, разный каждый день и для каждого аккаунта
        from datetime import date as _date
        today_seed = int(_date.today().strftime("%Y%m%d"))
        rng = random.Random(hash(session + mode) + today_seed)
        start_delay = rng.uniform(300, 2700)
        log.info(f"  [{name}] старт через {start_delay/60:.0f} мин ({mode})")
        await asyncio.sleep(start_delay)

        tier = get_account_tier(session)
        _, _, _, warmup_chats, _ = TIER_RULES.get(tier, TIER_RULES['green'])

        # Новые аккаунты: день 1 — тишина, день 2 — лурк (читаем чаты, без реакций)
        # Skip-chance не применяем — новым нужна стабильная активность каждый день
        if tier == 'new':
            age = _get_account_age(session)
            if age >= 2:
                lurk_chats = personal_handles_for(session, handles, 3)
                for h in lurk_chats:
                    try:
                        entity = await client.get_entity(h)
                        await client(ChanReadHistory(channel=entity, max_id=0))
                        db_log(session, "chat_read", h)
                        log.info(f"  [{name}] 👁 лурк {h} (day {age})")
                        await asyncio.sleep(random.uniform(60, 240))
                    except Exception as e:
                        log.debug(f"  [{name}] лурк {h}: {e}")
            else:
                log.info(f"  [{name}] new, день 1 — тишина")
            return

        # 12% — иногда пропускаем сессию (живой человек не всегда заходит)
        # Применяем только для активных аккаунтов, не для new
        if random.random() < SKIP_SESSION_CHANCE:
            log.info(f"  [{name}] пропускаю сессию ({mode})")
            return

        if warmup_chats == 0:
            log.info(f"  [{name}] тир '{tier}' — прогрев отключён")
            return

        if mode in ("morning", "evening"):
            # Личный набор чатов для этого аккаунта на сегодня
            chats = personal_handles_for(session, handles, warmup_chats)
            for h in chats:
                await read_and_react(session, h)
                await asyncio.sleep(random.uniform(60, 300))
        elif mode == "afternoon":
            chats = personal_handles_for(session, handles, max(2, warmup_chats // 3))
            for handle in chats:
                if done_today(session, "chat_read", handle):
                    continue
                try:
                    entity = await client.get_entity(handle)
                    await client(ChanReadHistory(channel=entity, max_id=0))
                    db_log(session, "chat_read", handle)
                    log.info(f"  [{name}] прочитал {handle}")
                    await asyncio.sleep(random.uniform(90, 300))  # было 30-120, увеличено
                except Exception as e:
                    log.debug(f"  [{name}] {handle}: {e}")

    results = await asyncio.gather(*[warmup_one(s) for s in clients], return_exceptions=True)
    for s, r in zip(list(clients.keys()), results):
        if isinstance(r, Exception):
            log.error(f"[warmup:{mode}] {s} упал: {r}")
    log.info(f"=== Warmup {mode} завершён ===")

# ── Переписка ─────────────────────────────────────────────────────────────────
def _apply_gender(text: str, gender: str) -> str:
    """Подставляет правильный род для слов от лица отправителя."""
    if gender == "female":
        return (text
            .replace("Понял", "Поняла")
            .replace("не писал", "не писала")
            .replace("написал", "написала")
            .replace("проснулся", "проснулась")
            .replace("занят ", "занята ")
            .replace("занят)", "занята)")
            .replace(" устал", " устала")
        )
    else:
        return (text
            .replace("Поняла", "Понял")
            .replace("не писала", "не писал")
            .replace("написала", "написал")
            .replace("проснулась", "проснулся")
            .replace("занята", "занят")
            .replace("устала", "устал")
        )

async def task_inter_chat():
    global _inter_chat_running
    if _inter_chat_running:
        log.info("[inter_chat] уже запущен — пропускаю")
        return
    _inter_chat_running = True
    try:
        await _task_inter_chat_inner()
    finally:
        _inter_chat_running = False

async def _task_inter_chat_inner():
    log.info("=== Переписка между менеджерами ===")
    sessions = [s for s in clients.keys() if get_account_tier(s) != 'new']
    if len(sessions) < 2:
        return

    pairs = [(sessions[i], sessions[j])
             for i in range(len(sessions))
             for j in range(i+1, len(sessions))]
    random.shuffle(pairs)
    # 15 пар вместо 5 — плотнее сеть общения, менее предсказуемо
    n_pairs = min(50, max(10, len(pairs) // 3))
    pairs = pairs[:n_pairs]

    async def resolve_target(sender_client, target_me, target_phone: str):
        """Резолвим получателя: username → импорт контакта по телефону → пропуск."""
        from telethon.tl.functions.contacts import ImportContactsRequest, DeleteContactsRequest
        from telethon.tl.types import InputPhoneContact
        if target_me.username:
            return f"@{target_me.username}"
        # Импортируем телефон как контакт, берём entity, удаляем контакт
        try:
            phone = target_phone.replace("+", "").strip()
            result = await sender_client(ImportContactsRequest([
                InputPhoneContact(client_id=0, phone=phone,
                                  first_name=target_me.first_name or "User",
                                  last_name="")
            ]))
            if result.users:
                user = result.users[0]
                # Удаляем контакт чтобы не засорять
                await sender_client(DeleteContactsRequest(id=[user]))
                return user
        except Exception as e:
            log.debug(f"  [chat] импорт контакта {phone}: {e}")
        return None

    async def chat_pair(s1, s2, idx):
        # Пропускаем если уже писали сегодня в любую сторону (проверяем оба типа логов)
        if (done_today(s1, "inter_message", s2) or done_today(s2, "inter_message", s1)
                or done_today(s2, "inter_reply", s1)):
            return
        await asyncio.sleep(random.uniform(idx * 120, idx * 120 + random.uniform(300, 900)))

        client1, me1 = clients[s1]
        client2, me2 = clients[s2]

        gender1 = accs_map.get(s1, {}).get("gender", "female")
        gender2 = accs_map.get(s2, {}).get("gender", "female")

        # Выбираем скрипт, opener которого s1 ещё не использовал сегодня
        try:
            conn = sqlite3.connect(DB_PATH, timeout=20)
            used = {r[0] for r in conn.execute(
                "SELECT detail FROM activity_log WHERE session=? AND type='inter_opener' AND date(done_at)=date('now')",
                (s1,)).fetchall()}
            conn.close()
        except Exception:
            used = set()
        candidates = [sc for sc in INTER_MESSAGES if sc[0] not in used]
        if not candidates:
            candidates = list(INTER_MESSAGES)
        random.shuffle(candidates)
        msgs = candidates[0]

        phone2 = accs_map.get(s2, {}).get("phone", "")
        phone1 = accs_map.get(s1, {}).get("phone", "")
        t1 = await resolve_target(client1, me2, phone2)
        t2 = await resolve_target(client2, me1, phone1)

        if t1 is None:
            log.warning(f"  [chat] не могу найти {me2.first_name}, пропуск")
            return
        if t2 is None:
            log.warning(f"  [chat] не могу найти {me1.first_name}, пропуск")
            return

        try:
            m0 = _apply_gender(msgs[0], gender1)
            m1 = _apply_gender(msgs[1], gender2)
            m2 = _apply_gender(msgs[2], gender1)
            # Оба читают чат друг с другом перед началом диалога
            try:
                await client1.send_read_acknowledge(t1)
                log.info(f"  [chat] {me1.first_name} прочитал чат с {me2.first_name}")
            except Exception:
                pass
            try:
                await client2.send_read_acknowledge(t2)
                log.info(f"  [chat] {me2.first_name} прочитал чат с {me1.first_name}")
            except Exception:
                pass
            await asyncio.sleep(random.uniform(3, 8))
            await client1.send_message(t1, m0)
            db_log(s1, "inter_message", s2)
            db_log(s1, "inter_opener", msgs[0])  # трекаем использованный opener
            log.info(f"  [chat] {me1.first_name} → {me2.first_name}: {m0}")
            await asyncio.sleep(random.uniform(60, 480))
            # client2 читает входящее перед ответом
            try:
                await client2.send_read_acknowledge(t2)
                log.info(f"  [chat] {me2.first_name} прочитал сообщение от {me1.first_name}")
            except Exception:
                pass
            await asyncio.sleep(random.uniform(3, 10))
            await client2.send_message(t2, m1)
            db_log(s2, "inter_reply", s1)
            log.info(f"  [chat] {me2.first_name} → {me1.first_name}: {m1}")
            await asyncio.sleep(random.uniform(30, 180))
            # client1 читает ответ перед следующим сообщением
            try:
                await client1.send_read_acknowledge(t1)
                log.info(f"  [chat] {me1.first_name} прочитал ответ от {me2.first_name}")
            except Exception:
                pass
            await asyncio.sleep(random.uniform(3, 10))
            await client1.send_message(t1, m2)
            log.info(f"  [chat] {me1.first_name} → {me2.first_name}: {m2}")
        except Exception as e:
            log.warning(f"  [chat] {me1.first_name}↔{me2.first_name}: {e}")

    results = await asyncio.gather(*[chat_pair(s1, s2, i) for i, (s1, s2) in enumerate(pairs)], return_exceptions=True)
    for (s1, s2), r in zip(pairs, results):
        if isinstance(r, Exception):
            log.error(f"[inter_chat] {s1}↔{s2} упал: {r}")
    log.info("=== Переписка завершена ===")

# ── Рассылка ──────────────────────────────────────────────────────────────────
def _generate_variation_sync(template: str) -> str:
    api_key = os.environ.get("LLM_API_KEY")
    if not api_key:
        return template
    base_url = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    model = os.environ.get("VARIATION_LLM_MODEL", "openai/gpt-4o")
    import urllib.request
    payload = json.dumps({
        "model": model,
        "max_tokens": 500,
        "messages": [{
            "role": "user",
            "content": (
                "Слегка перефразируй это Telegram-сообщение от менеджера по доставке товаров из Китая. "
                "Правила:\n"
                "- Все слова в {фигурных_скобках} оставь без изменений\n"
                "- Сохрани структуру: три абзаца с пустыми строками между ними\n"
                "- Пиши как живой человек в Telegram, разговорно и коротко\n"
                "- Запрещено: тире (—), дефисы как разделители, слова 'данный момент', 'реализуем', 'оперативно', 'визит', 'пространство'\n"
                "- Не делай текст длиннее оригинала\n"
                "Отвечай только переформулированным текстом, без пояснений.\n\n"
                f"{template}"
            )
        }]
    }).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"].strip()


async def generate_variation(template: str) -> str:
    """Генерирует лёгкую вариацию шаблона через OpenRouter. Fallback — оригинал."""
    try:
        return await asyncio.to_thread(_generate_variation_sync, template)
    except Exception as _e:
        log.debug(f"[variation] fallback на оригинал: {_e}")
        return template


def build_message(template, first_name, gender):
    uvidel = "Увидела" if gender == "female" else "Увидел"
    reshil = "решила"  if gender == "female" else "решил"
    hour = now_msk().hour
    privet = "Доброе утро" if hour < 12 else "Добрый вечер" if hour >= 18 else "Добрый день"
    return (template
        .replace("{ИМЯ_АККАУНТА}", first_name)
        .replace("{УВИДЕЛ}", uvidel)
        .replace("{РЕШИЛ}", reshil)
        .replace("{ПРИВЕТСТВИЕ}", privet))

async def task_sender():
    global _sender_running
    if _sender_running:
        log.info("[sender] уже запущен — пропускаю дублирующий запуск")
        return
    if not MSG_FILE.exists() and not MESSAGES_DIR.exists():
        return
    _sender_running = True
    try:
        await _task_sender_inner()
    finally:
        _sender_running = False

SQL_LIVE = "SELECT ct.tg_id FROM contacts ct JOIN conversations cv ON cv.contact_id=ct.id WHERE cv.account_id=? AND ct.status='replied' ORDER BY cv.updated_at DESC LIMIT 10"
SQL_TODAY = "SELECT detail FROM activity_log WHERE session=? AND type='chat_read' AND date(done_at)=date('now')"

async def _task_sender_inner():
    _msg_files = sorted(MESSAGES_DIR.glob("*.txt")) if MESSAGES_DIR.exists() else []

    # Перечитываем accounts.json чтобы подхватить изменения sender:true без рестарта
    fresh_accs = json.loads((OUTREACH_DIR / "accounts.json").read_text())
    if _GROUP is not None:
        fresh_accs = [a for a in fresh_accs if _stable_group(a["session"]) == _GROUP]
    for a in fresh_accs:
        accs_map[a["session"]] = a

    # Только аккаунты с флагом sender:true
    sender_sessions = [s for s, a in accs_map.items() if a.get("sender") and s in clients]
    if not sender_sessions:
        log.info("[sender] нет активных аккаунтов (нужен флаг sender:true)")
        return

    log.info(f"=== Рассылка: {len(sender_sessions)} аккаунтов ===")

    async def send_from(session, idx: int = 0):
        if session not in clients:
            return
        client, me = clients[session]
        acc = accs_map[session]
        gender = acc.get("gender", "female")

        # Размазываем старт: каждый аккаунт ждёт случайно от 1 до 8 мин
        # чтобы не все ломились к Telegram одновременно
        start_delay = random.uniform(60 + idx * 30, 180 + idx * 90)
        log.info(f"[{me.first_name}] старт через {start_delay/60:.1f} мин")
        await asyncio.sleep(start_delay)

        import sys; sys.path.insert(0, str(OUTREACH_DIR))
        from db import init_db, upsert_account, get_pending_contacts, mark_contact, add_message, pause_account, resume_account, increment_flood_count, reset_flood_count, mark_account_dead
        init_db()
        tier = get_account_tier(session)
        dm_cap, d_min, d_max, _, can_send = TIER_RULES.get(tier, TIER_RULES['green'])
        if not can_send:
            log.info(f"[{me.first_name}] тир '{tier}' — рассылка отключена")
            return
        # Пауза между сообщениями одного аккаунта — по тиру, "примерно" (±20%
        # джиттер), не фикс. Постепенное ускорение по мере роста доверия к
        # аккаунту; yellow (после флуда) — отдельно, медленнее blue, это про
        # восстановление после инцидента, а не про возраст.
        _PACE_MINUTES = {
            'blue':   60,
            'green':  45,
            'orange': 30,
            'purple': 20,
            'yellow': 90,
        }
        _pace = _PACE_MINUTES.get(tier, 30) * 60
        delay_min = round(_pace * 0.8)
        delay_max = round(_pace * 1.2)

        acc_daily = compute_daily_limit(session, tier)
        account_id = upsert_account(session, acc_daily, HOURLY_LIMIT)

        if sent_today(account_id) >= acc_daily:
            log.info(f"[{me.first_name}] тир '{tier}', лимит {acc_daily}/день — выполнен")
            return

        # Выбираем шаблон для этого аккаунта
        if _msg_files:
            _tpl_file = random.choice(_msg_files)
            _base_template = _tpl_file.read_text().strip()
            _tpl_name = _tpl_file.stem
        else:
            _base_template = MSG_FILE.read_text().strip()
            _tpl_name = "default"
        log.info(f"[{me.first_name}] шаблон: {_tpl_name}")

        contacts = get_pending_contacts(account_id, limit=200)
        # Reply rate аналитика
        try:
            _rr_conn = sqlite3.connect(DB_PATH, timeout=20)
            _rr = _rr_conn.execute(
                "SELECT COUNT(*) FROM messages WHERE account_id=? AND direction=?",
                (account_id, "in")
            ).fetchone()[0]
            _rs = _rr_conn.execute(
                "SELECT COUNT(*) FROM messages WHERE account_id=? AND direction=?",
                (account_id, "out")
            ).fetchone()[0]
            _rr_conn.close()
            _rate = round(_rr / _rs * 100) if _rs else 0
            log.info(f"[{me.first_name}] контактов: {len(contacts)}, отправлено: {sent_today(account_id)}/{acc_daily} | reply rate: {_rr}/{_rs} ({_rate}%)")
        except Exception:
            log.info(f"[{me.first_name}] контактов: {len(contacts)}, отправлено: {sent_today(account_id)}/{acc_daily}")

        if not contacts:
            log.info(f"[{me.first_name}] нет доступных контактов для рассылки")
        conn_check = sqlite3.connect(DB_PATH, timeout=25)
        for contact in contacts:
            if not (SEND_HOUR_START <= now_msk().hour < SEND_HOUR_END):
                log.info(f"[{me.first_name}] вне рабочих часов ({SEND_HOUR_START}-{SEND_HOUR_END}) — стоп")
                break
            if sent_today(account_id) >= acc_daily:
                log.info(f"[{me.first_name}] дневной лимит {acc_daily} исчерпан — стоп")
                break
            if sent_this_hour(account_id) >= HOURLY_LIMIT:
                log.info(f"[{me.first_name}] часовой лимит, жду 15 мин")
                await asyncio.sleep(900)
                continue

            cid = contact["id"]
            # Атомарная блокировка: UPDATE только если status='new' → ровно один аккаунт выиграет
            try:
                conn_check.execute(
                    "UPDATE contacts SET status='sending', account_id=? WHERE id=? AND status='new' AND replied_at IS NULL AND (account_id IS NULL OR account_id=?)",
                    (account_id, cid, account_id)
                )
                conn_check.commit()
                claimed = conn_check.execute("SELECT changes()").fetchone()[0]
            except Exception:
                claimed = 0
            if claimed == 0:
                continue  # Другой аккаунт уже взял этот контакт
            uname = contact.get("username")
            tg_id = contact["tg_id"]

            # Без username Telethon не может резолвить пользователя — пропускаем
            if not uname:
                mark_contact(cid, "skipped")
                log.info(f"[{me.first_name}] ⏭️  {tg_id} — нет username")
                continue

            target = f"@{uname}"

            # Уникальная вариация для каждого контакта
            _varied = await generate_variation(_base_template)
            message_text = build_message(_varied, me.first_name or "", gender)

            # ── Имитация живого поведения перед отправкой ─────────────────
            _target_entity = None
            try:
                _read_done = False

                # A: есть живые диалоги — заходим в один (проверяем ответы)
                try:
                    _db_pre = sqlite3.connect(DB_PATH, timeout=20)
                    _live = _db_pre.execute(SQL_LIVE, (account_id,)).fetchall()
                    _db_pre.close()
                    if _live:
                        _dlg_ent = await client.get_entity(int(random.choice(_live)[0]))
                        await client(GetHistoryRequest(
                            peer=_dlg_ent, limit=5, offset_date=None,
                            offset_id=0, max_id=0, min_id=0, add_offset=0, hash=0
                        ))
                        log.info(f"[{me.first_name}] 📬 проверяю диалог перед отправкой")
                        _read_done = True
                except Exception:
                    pass

                # B: чат уже посещённый сегодня (activity_log)
                if not _read_done:
                    try:
                        _db_pre2 = sqlite3.connect(DB_PATH, timeout=20)
                        _today = _db_pre2.execute(SQL_TODAY, (session,)).fetchall()
                        _db_pre2.close()
                        if _today:
                            _ent = await client.get_entity(random.choice(_today)[0])
                            await client(ChanReadHistory(channel=_ent, max_id=0))
                            _read_done = True
                    except Exception:
                        pass

                # C: fallback — любой чат из handles
                if not _read_done:
                    _hs = load_handles()
                    if _hs:
                        try:
                            _ent = await client.get_entity(random.choice(_hs))
                            await client(ChanReadHistory(channel=_ent, max_id=0))
                        except Exception:
                            pass

                # Шаг 2: пауза "читаю, думаю"
                await asyncio.sleep(random.uniform(30, 90))
                # Шаг 3: появляемся онлайн, потом typing indicator
                await client(UpdateStatusRequest(offline=False))
                await asyncio.sleep(random.uniform(2, 5))
                _target_entity = await client.get_entity(target)
                await client(SetTypingRequest(peer=_target_entity, action=SendMessageTypingAction()))
                # Шаг 4: реалистичное время набора (WPM + паузы на обдумывание)
                # У каждого аккаунта своя скорость печати (стабильна, уникальна)
                _pers_rng = random.Random(hash(session) % 99991)
                _wpm = _pers_rng.uniform(32, 68)  # слов/мин: 32 (медленно) – 68 (быстро)
                _words = max(1, len(message_text.split()))
                _base_typing = (_words / _wpm) * 60
                # Случайные микро-паузы (обдумывание, исправление опечатки)
                _pauses = random.randint(0, 2)
                _pause_time = sum(random.uniform(1.0, 3.5) for _ in range(_pauses))
                _type_delay = _base_typing + _pause_time
                await asyncio.sleep(min(_type_delay, 35))
            except Exception as _e:
                log.warning(f"[{me.first_name}] шаг имитации набора для {target} пропущен: {type(_e).__name__}: {_e}")
            # ──────────────────────────────────────────────────────────────

            try:
                # Переиспользуем уже резолвленную сущность из шага имитации набора —
                # избегаем второго резолва того же юзернейма.
                msg = await client.send_message(_target_entity or target, message_text)
            except FloodWaitError as e:
                log.warning(f"[{me.first_name}] FloodWait {e.seconds}с")
                # Откатываем claimed контакт обратно в new
                try:
                    conn_check.execute("UPDATE contacts SET status='new' WHERE id=? AND status='sending'", (cid,))
                    conn_check.commit()
                except Exception:
                    pass
                pause_account(account_id, e.seconds + 60)
                await asyncio.sleep(e.seconds + 60)
                resume_account(account_id)
                continue
            except PeerFloodError:
                flood_n = increment_flood_count(account_id)
                _sent_ctx = sent_today(account_id)
                log.warning(f"[{me.first_name}] PeerFlood при sent_today={_sent_ctx}, тир={tier}")
                _delays = [
                    1*86400,   # #1 → 1 день
                    2*86400,   # #2 → 2 дня
                    3*86400,   # #3 → 3 дня
                    7*86400,   # #4 → 7 дней
                    10*86400,  # #5 → 10 дней
                    14*86400,  # #6 → 14 дней
                    21*86400,  # #7 → 21 день
                    30*86400,  # #8 → 30 дней
                ]
                if flood_n > len(_delays):
                    mark_account_dead(account_id)
                    log.warning(f"[{me.first_name}] PeerFlood #{flood_n} -> DEAD")
                    tg_alert(f"[DEAD] {me.first_name}: PeerFlood {flood_n} раз — аккаунт помечен мёртвым.")
                else:
                    _delay = _delays[flood_n - 1]
                    _days  = _delay // 86400
                    pause_account(account_id, _delay)
                    log.warning(f"[{me.first_name}] PeerFlood #{flood_n} — пауза {_days}д")
                    tg_alert(f"[PeerFlood #{flood_n}] {me.first_name}: пауза {_days}д.")
                break
            except (UserDeactivatedBanError, AuthKeyUnregisteredError) as e:
                pause_account(account_id, 48 * 3600)
                log.warning(f"[{me.first_name}] 🧊 аккаунт заморожен TG: {type(e).__name__} — пауза 48ч")
                tg_alert(f"[FROZEN] {me.first_name}: Telegram заморозил аккаунт ({type(e).__name__}). Пауза 48ч.")
                break
            except (UserPrivacyRestrictedError, UserIsBlockedError):
                mark_contact(cid, "skipped")
                log.info(f"[{me.first_name}] ⏭️  {target} — приватность/блок")
                await asyncio.sleep(random.uniform(delay_min, delay_max))
                continue
            except (InputUserDeactivatedError, UsernameNotOccupiedError, UsernameInvalidError):
                mark_contact(cid, "failed")
                log.info(f"[{me.first_name}] ❌ {target} — не существует")
                await asyncio.sleep(random.uniform(delay_min, delay_max))
                continue
            except Exception as e:
                err_name = type(e).__name__
                err_str  = str(e)
                _frozen_markers = ("USER_DEACTIVATED_BAN", "ACCOUNT_BANNED", "AUTH_KEY_UNREGISTERED",
                                   "UserDeactivatedBan", "AccountBanned", "AuthKeyUnregistered")
                if any(m in err_name or m in err_str for m in _frozen_markers):
                    pause_account(account_id, 48 * 3600)
                    log.warning(f"[{me.first_name}] 🧊 аккаунт заморожен TG: {err_name} — пауза 48ч")
                    tg_alert(f"[FROZEN] {me.first_name}: Telegram заморозил аккаунт ({err_name}). Пауза 48ч.")
                    break
                elif "PrivacyPremiumRequired" in err_name or "PRIVACY_PREMIUM_REQUIRED" in err_str:
                    mark_contact(cid, "skipped")
                    log.info(f"[{me.first_name}] ⏭️  {target} — только Premium")
                elif err_name == "ValueError" and "No user has" in err_str and uname:
                    # Это не баг Telethon — ValueError тут лишь пересказывает ответ сервера
                    # (UsernameNotOccupiedError), т.е. сам Telegram в моменте сказал "не найден"
                    # для реального юзернейма. Мгновенный повтор с высокой вероятностью
                    # упрётся в то же самое — ждём немного и пробуем через сырой API-запрос.
                    await asyncio.sleep(random.uniform(120, 180))
                    try:
                        from telethon.tl.functions.contacts import ResolveUsernameRequest
                        _resolved = await client(ResolveUsernameRequest(uname))
                        _peer_user = _resolved.users[0] if _resolved.users else None
                        if _peer_user:
                            msg = await client.send_message(_peer_user, message_text)
                            for _db_attempt in range(3):
                                try:
                                    add_message(cid, account_id, "out", message_text, msg.id, _tpl_name)
                                    mark_contact(cid, "sent", account_id)
                                    log.info(f"[{me.first_name}] ✅ {target} (после ручного resolve)")
                                    break
                                except Exception:
                                    await asyncio.sleep(1)
                            await asyncio.sleep(random.uniform(delay_min, delay_max))
                            continue
                        else:
                            raise ValueError("resolve вернул пустой список users")
                    except Exception as _re:
                        try:
                            conn_check.execute("UPDATE contacts SET status='new' WHERE id=? AND status='sending'", (cid,))
                            conn_check.commit()
                        except Exception:
                            pass
                        log.warning(f"[{me.first_name}] ⚠️  {target}: ручной resolve тоже не помог: {_re} (контакт в new, попробуем снова)")
                else:
                    # Сетевая/DB ошибка — откатываем sending → new, попробуем снова
                    try:
                        conn_check.execute("UPDATE contacts SET status='new' WHERE id=? AND status='sending'", (cid,))
                        conn_check.commit()
                    except Exception:
                        pass
                    _proxy_host = acc["proxy"][1] if acc.get("proxy") else None
                    log.warning(f"[{me.first_name}] ⚠️  {target}: [{err_name}] {e} | прокси={_proxy_host} (контакт в new, попробуем снова)")
                await asyncio.sleep(random.uniform(delay_min, delay_max))
                continue

            # Сообщение ушло — сохраняем в DB с retry при lock
            for _db_attempt in range(3):
                try:
                    add_message(cid, account_id, "out", message_text, msg.id, _tpl_name)
                    mark_contact(cid, "sent", account_id)
                    log.info(f"[{me.first_name}] ✅ {target}")
                    break
                except Exception as db_e:
                    if _db_attempt < 2:
                        await asyncio.sleep(1)
                    else:
                        log.warning(f"[{me.first_name}] ⚠️  DB retry failed для {target}: {db_e} (контакт в new)")

            await asyncio.sleep(random.uniform(delay_min, delay_max))
        conn_check.close()

    await asyncio.gather(*[send_from(s, idx) for idx, s in enumerate(sender_sessions)])
    log.info("=== Рассылка завершена ===")

# ── Планировщик ───────────────────────────────────────────────────────────────
last_run: dict[str, str] = {}  # task → key_date
_schedule_date: str = ""       # дата для которой вычислено расписание
_daily_schedule: list = []     # [(hour, minute, [tasks]), ...]


def _build_daily_schedule(date_str: str) -> list:
    """Каждый день — новое расписание с ±15 мин джиттером.
    Seeded от даты → одинаково на весь день, но разное каждый следующий день."""
    rng = random.Random(int(date_str.replace("-", "")))
    schedule = [
        # утренний прогрев: 08:45 – 09:15
        (8 + (rng.randint(45, 59) >= 60), rng.randint(45, 59) % 60,
         ["warmup_morning", "upgrade_accounts"]),
        # первая переписка: 10:30 – 11:15
        (10, rng.randint(30, 59), ["inter_chat"]),
        # дневной прогрев: 13:45 – 14:15
        (13, rng.randint(45, 59), ["warmup_afternoon"]),
        # вторая переписка: 14:00 – 14:45
        (14, rng.randint(5, 45),  ["inter_chat"]),
        # третья переписка: 18:15 – 19:00
        (18, rng.randint(15, 59), ["inter_chat"]),
        # вечерний прогрев: 19:00 – 19:20
        (19, rng.randint(0, 20),  ["warmup_evening"]),
        # четвёртая переписка: 20:30 – 21:00
        (20, rng.randint(30, 59), ["inter_chat"]),
    ]
    # Рассылка — каждые ~30 минут в рабочем окне (SEND_HOUR_START-SEND_HOUR_END),
    # а не редкие отдельные слоты. Лимиты/паузы по тиру и так ограничивают объём —
    # чаще перезапускать безопасно, зато застрявшие (часовой лимит, ошибка резолва
    # и т.п.) аккаунты получают шанс попробовать снова гораздо быстрее.
    minute = rng.randint(0, 10)
    hour = SEND_HOUR_START
    while hour < SEND_HOUR_END:
        schedule.append((hour, minute, ["sender"]))
        minute += 30
        if minute >= 60:
            minute -= 60
            hour += 1
    return schedule


def _launch_task(task: str):
    if task == "warmup_morning":
        asyncio.create_task(task_warmup("morning"))
    elif task == "warmup_afternoon":
        asyncio.create_task(task_warmup("afternoon"))
    elif task == "warmup_evening":
        asyncio.create_task(task_warmup("evening"))
    elif task == "inter_chat":
        asyncio.create_task(task_inter_chat())
    elif task == "sender":
        asyncio.create_task(task_sender())
    elif task == "upgrade_accounts":
        asyncio.create_task(task_upgrade_accounts())


async def scheduler():
    global _schedule_date, _daily_schedule
    log.info("Планировщик запущен")
    while running:
        now = now_msk()
        key_date = now.strftime("%Y-%m-%d")

        # Пересчитываем расписание на новый день
        if key_date != _schedule_date:
            _daily_schedule = _build_daily_schedule(key_date)
            _schedule_date = key_date
            last_run.clear()
            log.info(f"[scheduler] расписание на {key_date}:")
            for h, m, tasks in _daily_schedule:
                log.info(f"  {h:02d}:{m:02d} → {', '.join(tasks)}")

        # Файл-триггер: echo "sender" > /tmp/force_task
        # Проверяем триггер для своей группы И общий
        _trigger_paths = [Path("/tmp/force_task")]
        if _GROUP is not None:
            _trigger_paths.insert(0, Path(f"/tmp/force_task_group{_GROUP}"))
        for trigger in _trigger_paths:
            if trigger.exists():
                try:
                    cmd = trigger.read_text().strip()
                    trigger.unlink()
                    log.info(f"[trigger] принудительный запуск: {cmd}")
                    _launch_task(cmd)
                except Exception as e:
                    log.debug(f"[trigger] ошибка: {e}")
                break

        for hour, minute, tasks in _daily_schedule:
            if now.hour == hour and now.minute == minute:
                for task in tasks:
                    # Ключ включает час:минуту слота — иначе второй и третий заход одной и той
                    # же задачи считался бы "уже было сегодня"
                    slot_key = f"{task}_{key_date}_{hour:02d}{minute:02d}"
                    if last_run.get(slot_key):
                        continue
                    last_run[slot_key] = True
                    log.info(f"Запускаю задачу: {task} ({hour:02d}:{minute:02d})")
                    _launch_task(task)

        await asyncio.sleep(30)

# ── Keepalive / Watchdog ──────────────────────────────────────────────────────
async def keepalive():
    """Watchdog: пингует аккаунты каждые 5 минут.
    На сбой: до 3 попыток переподключения.
    После 3 неудач: убирает из clients, помечает disconnected, алерт в Telegram."""
    fail_counts: dict[str, int] = {}  # session → кол-во подряд идущих неудач

    while running:
        await asyncio.sleep(300)
        for session, (client, me) in list(clients.items()):
            name = (me.first_name if me else None) or session[-12:]
            try:
                await client.get_me()
                fail_counts.pop(session, None)  # пинг ок — сбрасываем счётчик
            except AuthKeyDuplicatedError:
                # Немедленно — без retry
                clients.pop(session, None)
                bad_auth_sessions.add(session)
                try:
                    _c = sqlite3.connect(DB_PATH, timeout=20)
                    _c.execute("UPDATE accounts SET status='auth_error' WHERE session=?", (session,))
                    _c.commit()
                    _c.close()
                except Exception:
                    pass
                tg_alert(f"🔑 <b>Auth key отозван:</b> {name}\nНужна повторная авторизация (QR)")
                log.error(f"[watchdog] {name} — AuthKeyDuplicated, убран из пула")
            except Exception as e:
                fails = fail_counts.get(session, 0) + 1
                fail_counts[session] = fails
                log.warning(f"[watchdog] {name} ping failed ({fails}/3): {e}")

                # Пробуем переподключить
                reconnected = False
                try:
                    await client.connect()
                    check = await client.get_me()
                    if check:
                        log.info(f"[watchdog] {name} переподключён ✅")
                        fail_counts.pop(session, None)
                        reconnected = True
                except Exception as re:
                    log.error(f"[watchdog] {name} реконнект failed: {re}")

                if not reconnected and fails >= 3:
                    clients.pop(session, None)
                    try:
                        _c = sqlite3.connect(DB_PATH, timeout=20)
                        _c.execute("UPDATE accounts SET status='disconnected' WHERE session=?", (session,))
                        _c.commit()
                        _c.close()
                    except Exception:
                        pass
                    tg_alert(
                        f"⚠️ <b>Аккаунт отвалился:</b> {name}\n"
                        f"Попыток: 3/3 — помечен disconnected\n"
                        f"reconnect_loop попробует восстановить"
                    )
                    log.error(f"[watchdog] {name} → disconnected после 3 неудач")


# ── Supabase синк ─────────────────────────────────────────────────────────────
async def sync_loop():
    """Синхронизирует outreach.db → Supabase каждую минуту."""
    import subprocess
    while running:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: subprocess.run(
                [sys.executable, "sync_to_supabase.py"],
                cwd=str(OUTREACH_DIR),
                capture_output=True, timeout=120
            ))
            log.info("[sync] supabase ok")
        except Exception as e:
            log.warning(f"[sync] ошибка: {e}")
        await asyncio.sleep(60)


# ── Auto-resume expired pauses ────────────────────────────────────────────────
async def auto_resume_loop():
    """Каждые 60 сек размораживает аккаунты у которых истёк paused_until."""
    while running:
        try:
            from datetime import datetime as _dt, timezone as _tz
            now_str = _dt.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%S")
            conn = sqlite3.connect(DB_PATH, timeout=20)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT id, session FROM accounts WHERE status='paused' AND paused_until IS NOT NULL AND paused_until < ?",
                (now_str,)
            ).fetchall()
            for r in rows:
                conn.execute("UPDATE accounts SET status='active', paused_until=NULL WHERE id=?", (r["id"],))
                log.info(f"[auto-resume] {r['session']} разморожен")
            if rows:
                conn.commit()
                if SEND_HOUR_START <= now_msk().hour < SEND_HOUR_END:
                    log.info(f"[auto-resume] запускаю sender для размороженных аккаунтов")
                    asyncio.create_task(task_sender())
            conn.close()
        except Exception as e:
            log.warning(f"[auto-resume] ошибка: {e}")
        await asyncio.sleep(60)


# ── Health check ──────────────────────────────────────────────────────────────
async def health_loop():
    """Каждые 30 мин проверяет что задачи выполнились. Алертит если нет."""
    await asyncio.sleep(1800)  # первая проверка через 30 мин после старта
    while running:
        try:
            now = now_msk()
            today = now.strftime("%Y-%m-%d")
            conn = sqlite3.connect(DB_PATH, timeout=25)

            # Проверяем рассылку: если уже после 14:30 МСК и 0 отправлено сегодня
            if now.hour >= 14:
                sent = conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE direction='out' AND date(sent_at)=date('now')"
                ).fetchone()[0]
                if sent == 0:
                    tg_alert(f"⚠️ <b>Рассылка не запустилась!</b>\nВремя: {now.strftime('%H:%M')} МСК\nОтправлено сегодня: 0\n\nЗапускаю автоматически...")
                    log.warning("[health] рассылка не запущена — запускаю")
                    asyncio.create_task(task_sender())

            # Проверяем подключение аккаунтов
            connected = len(clients)
            total = len(accs_map)
            threshold = max(1, int(total * 0.6))
            if connected < threshold:
                tg_alert(f"⚠️ <b>Мало аккаунтов подключено:</b> {connected}/{total}\nВозможны проблемы с прокси.")

            conn.close()
        except Exception as e:
            log.warning(f"[health] ошибка: {e}")

        await asyncio.sleep(1800)

# ── Старт ─────────────────────────────────────────────────────────────────────
async def check_proxy_tcp(host: str, port: int) -> bool:
    """TCP-проверка прокси за 5 секунд."""
    import socket as _sock
    loop = asyncio.get_event_loop()
    def _check():
        try:
            s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
            s.settimeout(5)
            result = s.connect_ex((host, port))
            s.close()
            return result == 0
        except Exception:
            return False
    return await loop.run_in_executor(None, _check)

async def main():
    global running

    # WAL mode — разрешает параллельные читатели, меньше DB locked
    try:
        _wc = sqlite3.connect(DB_PATH, timeout=20)
        _wc.execute("PRAGMA journal_mode=WAL")
        _wc.close()
    except Exception:
        pass

    accs = json.loads((OUTREACH_DIR / "accounts.json").read_text())
    if _GROUP is not None:
        accs = [a for a in accs if _stable_group(a["session"]) == _GROUP]
        log.info(f"[group {_GROUP_LETTER.upper()}] фильтр: {len(accs)} аккаунтов в группе")
    for acc in accs:
        accs_map[acc["session"]] = acc

    # Сброс disconnected → active при старте (могли вылететь из-за db-locked)
    try:
        _rc = sqlite3.connect(DB_PATH, timeout=20)
        affected = _rc.execute(
            "UPDATE accounts SET status='active' WHERE status='disconnected'"
        ).rowcount
        _rc.commit()
        _rc.close()
        if affected:
            log.info(f"[startup] сброс {affected} disconnected → active")
    except Exception as _re:
        log.warning(f"[startup] reset disconnected error: {_re}")

    # Сброс зависших 'sending' → 'new' (контакты, которые были заблокированы
    # предыдущим запуском демона во время pre-send ритуала но так и не отправились)
    try:
        _sc = sqlite3.connect(DB_PATH, timeout=20)
        stuck = _sc.execute(
            "UPDATE contacts SET status='new' WHERE status='sending'"
        ).rowcount
        _sc.commit()
        _sc.close()
        if stuck:
            log.info(f"[startup] сброс {stuck} зависших 'sending' → 'new'")
    except Exception as _se:
        log.warning(f"[startup] reset sending error: {_se}")

    log.info(f"Подключаю {len(accs)} аккаунтов...")

    CONNECT_BATCH_SIZE  = 1     # по одному аккаунту — плавный старт
    CONNECT_BATCH_DELAY = 120.0 # ~2 мин между аккаунтами (10 акк = 20 мин)

    _DEVICES = [
        ("Samsung Galaxy S21",  "Android 12", "9.6.3"),
        ("Samsung Galaxy S22",  "Android 12", "9.6.3"),
        ("Samsung Galaxy S22+", "Android 13", "9.6.3"),
        ("Samsung Galaxy S23",  "Android 13", "9.6.3"),
        ("Samsung Galaxy S23+", "Android 13", "9.6.8"),
        ("Samsung Galaxy S24",  "Android 14", "9.6.8"),
        ("Xiaomi 12",           "Android 12", "9.6.3"),
        ("Xiaomi 13",           "Android 13", "9.6.3"),
        ("Xiaomi 13 Pro",       "Android 13", "9.6.8"),
        ("Google Pixel 7",      "Android 13", "9.6.3"),
        ("Google Pixel 8",      "Android 14", "9.6.8"),
        ("OnePlus 11",          "Android 13", "9.6.3"),
        ("OnePlus 12",          "Android 14", "9.6.8"),
        ("Realme GT 5",         "Android 13", "9.6.8"),
        ("OPPO Find X6",        "Android 13", "9.6.8"),
        ("Vivo X90 Pro",        "Android 13", "9.6.8"),
    ]

    def _get_device(acc: dict):
        """Берёт device из accounts.json если есть, иначе возвращает пустой dict
        (Telethon использует дефолтные строки — безопасно для существующих сессий).
        Для новых аккаунтов (device_model сохранён при авторизации) — использует сохранённое."""
        if acc.get("device_model"):
            return dict(
                device_model=acc["device_model"],
                system_version=acc.get("system_version", ""),
                app_version=acc.get("app_version", "9.6.3"),
                lang_code="ru",
                system_lang_code="ru-RU",
            )
        return {}  # дефолт Telethon — не меняем существующие сессии

    def _assign_device(session: str) -> dict:
        """Выбирает устройство для новой сессии по хэшу — вызывается при первой авторизации."""
        idx = int(hashlib.md5(session.encode()).hexdigest(), 16) % len(_DEVICES)
        model, sysver, appver = _DEVICES[idx]
        return {"device_model": model, "system_version": sysver, "app_version": appver}

    async def connect_batch(batch):
        await asyncio.gather(*[connect_one(a, j) for j, a in enumerate(batch)])

    def register_incoming_handler(client, session, me):
        """Регистрирует обработчик входящих для (пере)подключённого клиента.
        Вызывается из connect_one — покрывает и стартовый батч, и reconnect_loop,
        иначе аккаунты, поднятые позже стартового батча, никогда не ловят ответы."""
        try:
            _c = sqlite3.connect(DB_PATH, timeout=20)
            _row = _c.execute("SELECT id FROM accounts WHERE session=?", (session,)).fetchone()
            _c.close()
        except Exception as _e:
            log.warning(f"[incoming] {session}: не удалось получить account_id: {_e}")
            return
        if not _row:
            return
        _acc_id = _row[0]
        acc_clients[_acc_id] = client

        @client.on(events.NewMessage(incoming=True))
        async def _on_msg(ev, _c=client, _aid=_acc_id, _m=me):
            await handle_incoming(_c, _aid, _m, ev)

        log.info(f"[incoming] хендлер зарегистрирован: {session}")

    async def connect_one(acc, idx: int = 0):
        session = acc["session"]
        proxy = acc.get("proxy")
        proxy_arg = tuple(proxy) if proxy else None
        if proxy_arg is None:
            log.warning(f"[{session}] нет прокси — в спячку, без прокси не подключаем")
            return
        # Маленький стаггер внутри батча: 0.5с между аккаунтами
        await asyncio.sleep(idx * 0.5)
        # QR lockfile: если идёт авторизация — не подключаем, чтобы не вызвать AuthKeyDuplicated
        if Path(f"/tmp/qr_lock_{session}").exists():
            log.info(f"[{session}] QR авторизация в процессе — пропускаю подключение")
            return
        for attempt in range(6):
            try:
                client = TelegramClient(
                    str(OUTREACH_DIR / session),
                    acc["api_id"], acc["api_hash"],
                    proxy=proxy_arg,
                    **_get_device(acc)
                )
                await client.connect()
                me = await client.get_me()
                if me is None:
                    log.error(f"  ❌ {session}: get_me() вернул None — сессия устарела, нужна QR-реавторизация")
                    await client.disconnect()
                    try:
                        _c = sqlite3.connect(DB_PATH, timeout=20)
                        _c.execute("UPDATE accounts SET status='auth_error' WHERE session=?", (session,))
                        _c.commit()
                        _c.close()
                    except Exception as _e:
                        log.warning(f"  ⚠️  не удалось обновить статус {session}: {_e}")
                    tg_alert(f"🔑 <b>Сессия устарела:</b> {session[-12:]}\nget_me() вернул None — нужна QR-реавторизация")
                    return
                clients[session] = (client, me)
                register_incoming_handler(client, session, me)
                log.info(f"  ✅ {me.first_name} ({session})")
                try:
                    _c = sqlite3.connect(DB_PATH, timeout=20)
                    _c.execute("UPDATE accounts SET status='active' WHERE session=? AND status NOT IN ('dead','auth_error')", (session,))
                    _c.commit()
                    _c.close()
                except Exception:
                    pass
                try:
                    _af = OUTREACH_DIR / "accounts.json"
                    _accs = json.loads(_af.read_text())
                    for _a in _accs:
                        if _a["session"] == session:
                            changed = False
                            if me.first_name and _a.get("first_name") != me.first_name:
                                _a["first_name"] = me.first_name
                                changed = True
                            if me.last_name and _a.get("last_name") != me.last_name:
                                _a["last_name"] = me.last_name
                                changed = True
                            if changed:
                                _af.write_text(json.dumps(_accs, ensure_ascii=False, indent=2))
                            break
                except Exception:
                    pass
                return
            except AuthKeyDuplicatedError:
                try:
                    await client.disconnect()
                except Exception:
                    pass
                log.error(f"  ❌ {session}: AuthKeyDuplicatedError — auth key отозван, нужна повторная авторизация")
                bad_auth_sessions.add(session)
                try:
                    _c = sqlite3.connect(DB_PATH, timeout=20)
                    _c.execute("UPDATE accounts SET status='auth_error' WHERE session=?", (session,))
                    _c.commit()
                    _c.close()
                except Exception as _e:
                    log.warning(f"  ⚠️  не удалось обновить статус {session}: {_e}")
                return
            except Exception as e:
                err = str(e)
                try:
                    await client.disconnect()
                except Exception:
                    pass
                if attempt < 5 and ("database is locked" in err or "timed out" in err.lower() or "Proxy" in err):
                    wait = 15 + attempt * 20
                    log.warning(f"  ⚠️  {session}: {e} — retry {attempt+1}/6 через {wait}с")
                    await asyncio.sleep(wait)
                else:
                    log.error(f"  ❌ {session}: {e}")
                    return

    for _bi in range(0, len(accs), CONNECT_BATCH_SIZE):
        _batch = accs[_bi:_bi + CONNECT_BATCH_SIZE]
        log.info(f"[startup] батч {_bi // CONNECT_BATCH_SIZE + 1}: {len(_batch)} аккаунтов")
        await connect_batch(_batch)
        if _bi + CONNECT_BATCH_SIZE < len(accs):
            delay = CONNECT_BATCH_DELAY + random.uniform(-30, 30)
            log.info(f"[startup] пауза {delay:.0f}с перед следующим аккаунтом")
            await asyncio.sleep(delay)
    log.info(f"Подключено: {len(clients)}/{len(accs)}")
    tg_alert(f"✅ Daemon запущен: {len(clients)}/{len(accs)} аккаунтов подключено")

    # Регистрация хендлеров входящих теперь происходит внутри connect_one() —
    # для стартового батча выше и для reconnect_loop() ниже одинаково.
    log.info(f"[incoming] хендлеры зарегистрированы на {len(acc_clients)} аккаунтах")

    async def reconnect_loop():
        """Каждые 5 мин переподключает аккаунты, выпавшие при старте (db locked, proxy timeout и т.д.).
        Аккаунты со статусом dead/disconnected/auth_error не трогаем."""
        reconnect_fail_count: dict[str, int] = {}
        proxy_swap_count: dict[str, int] = {}
        proxy_exhausted_sessions: set[str] = set()
        while running:
            await asyncio.sleep(300)
            # Подхватываем новые аккаунты, добавленные в accounts.json после старта
            try:
                _fresh = json.loads((OUTREACH_DIR / "accounts.json").read_text())
                if _GROUP is not None:
                    _fresh = [a for a in _fresh if _stable_group(a["session"]) == _GROUP]
                _new_accs = [a for a in _fresh if a["session"] not in accs_map]
                for _a in _new_accs:
                    accs_map[_a["session"]] = _a
                    log.info(f"[reconnect] новый аккаунт обнаружен: {_a['session']}")
            except Exception as _e:
                log.warning(f"[reconnect] ошибка загрузки accounts.json: {_e}")
            missing = [a for a in accs_map.values() if a["session"] not in clients]
            if not missing:
                continue
            # Сбрасываем счётчики для тех, кто больше не в missing (переподключились)
            _missing_sessions = {a["session"] for a in missing}
            for _s in list(reconnect_fail_count):
                if _s not in _missing_sessions:
                    reconnect_fail_count.pop(_s, None)
                    proxy_swap_count.pop(_s, None)
            # Не трогаем dead, disconnected, auth_error и аккаунты с отозванным ключом
            to_reconnect = []
            try:
                _c = sqlite3.connect(DB_PATH, timeout=20)
                _c.row_factory = sqlite3.Row
                for acc in missing:
                    if acc["session"] in bad_auth_sessions or acc["session"] in proxy_exhausted_sessions:
                        continue
                    row = _c.execute(
                        "SELECT status FROM accounts WHERE session=?", (acc["session"],)
                    ).fetchone()
                    if (not row) or row["status"] not in ("dead", "auth_error"):
                        to_reconnect.append(acc)
                _c.close()
            except Exception as _e:
                log.warning(f"[reconnect] ошибка чтения DB: {_e}")
                continue
            if not to_reconnect:
                continue
            # Аккаунты, не подключившиеся 2+ раза подряд — вероятно, мёртвый прокси.
            # Меняем на резервный из пула (та же логика, что в proxy_health_loop для уже подключённых).
            for acc in to_reconnect:
                session = acc["session"]
                reconnect_fail_count[session] = reconnect_fail_count.get(session, 0) + 1
                if reconnect_fail_count[session] < 2 or not acc.get("proxy"):
                    continue
                reconnect_fail_count[session] = 0
                if proxy_swap_count.get(session, 0) >= 3:
                    proxy_exhausted_sessions.add(session)
                    log.warning(f"[reconnect] {session[-12:]}: 3 разных прокси не помогли — нужна ручная замена")
                    tg_alert(f"🆘 {session[-12:]}: 3 прокси подряд не сработали — нужна ручная замена прокси")
                    continue
                old_proxy = acc["proxy"]
                spare = None
                try:
                    _sc = sqlite3.connect(DB_PATH, timeout=20)
                    _sr = _sc.execute(
                        "SELECT protocol, host, port, username, password FROM proxies "
                        "WHERE assigned_to IS NULL AND active=1 ORDER BY RANDOM() LIMIT 1"
                    ).fetchone()
                    if _sr:
                        spare = [_sr[0], _sr[1], _sr[2], True, _sr[3], _sr[4]]
                        _sc.execute("UPDATE proxies SET assigned_to=? WHERE host=? AND port=?",
                                    (session, _sr[1], _sr[2]))
                        _sc.execute(
                            "UPDATE proxies SET assigned_to=NULL WHERE host=? AND port=? AND assigned_to=?",
                            (old_proxy[1], old_proxy[2], session))
                    _sc.commit()
                    _sc.close()
                except Exception as _pe:
                    log.warning(f"[reconnect] ошибка поиска резерва для {session}: {_pe}")
                if not spare:
                    log.warning(f"[reconnect] {session[-12:]}: прокси {old_proxy[1]} недоступен, резервов нет")
                    continue
                proxy_swap_count[session] = proxy_swap_count.get(session, 0) + 1
                log.info(f"[reconnect] {session[-12:]}: прокси {old_proxy[1]} недоступен → резерв {spare[1]} (замена #{proxy_swap_count[session]})")
                acc["proxy"] = spare
                try:
                    _af = OUTREACH_DIR / "accounts.json"
                    _accs_f = json.loads(_af.read_text())
                    for _a in _accs_f:
                        if _a["session"] == session:
                            _a["proxy"] = spare
                            break
                    _af.write_text(json.dumps(_accs_f, ensure_ascii=False, indent=2))
                except Exception as _fe:
                    log.warning(f"[reconnect] не удалось сохранить accounts.json: {_fe}")
            names = [a["session"].replace("manager_", "") for a in to_reconnect]
            log.info(f"[reconnect] переподключаю {len(to_reconnect)}: {names}")
            for _bi in range(0, len(to_reconnect), CONNECT_BATCH_SIZE):
                _batch = to_reconnect[_bi:_bi + CONNECT_BATCH_SIZE]
                await connect_batch(_batch)
                if _bi + CONNECT_BATCH_SIZE < len(to_reconnect):
                    delay = CONNECT_BATCH_DELAY + random.uniform(-30, 30)
                    await asyncio.sleep(delay)
            log.info(f"[reconnect] итого подключено: {len(clients)}/{len(accs_map)}")

    def shutdown(sig, frame):
        global running
        log.info("Завершение — останавливаю задачи...")
        running = False
        # Отменяем все asyncio задачи — прерывает asyncio.sleep() немедленно
        # вместо ожидания таймаута (300/1800 сек) до следующей проверки running
        try:
            loop = asyncio.get_event_loop()
            for task in asyncio.all_tasks(loop):
                task.cancel()
        except Exception as e:
            log.warning(f"[shutdown] cancel error: {e}")
        log.info("Задачи отменены, ожидаю завершения event loop.")

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    def reload_config(sig, frame):
        try:
            fresh = json.loads((OUTREACH_DIR / "accounts.json").read_text())
            if _GROUP is not None:
                fresh = [a for a in fresh if _stable_group(a["session"]) == _GROUP]
            for a in fresh:
                accs_map[a["session"]] = a
            log.info(f"[reload] accounts.json перечитан ({len(fresh)} аккаунтов)")
            tg_alert("🔄 Config перезагружен (SIGHUP)")
        except Exception as e:
            log.error(f"[reload] ошибка: {e}")

    signal.signal(signal.SIGHUP, reload_config)

    # При запуске: строим расписание заранее чтобы catch-up мог его использовать
    global _daily_schedule, _schedule_date
    _catchup_date = now_msk().strftime('%Y-%m-%d')
    if not _daily_schedule:
        _daily_schedule = _build_daily_schedule(_catchup_date)
        _schedule_date = _catchup_date

    # При запуске: если пропустили задачу менее 2 часов назад — запускаем
    now_s = now_msk()
    for hour, minute, tasks in _daily_schedule:
        sched_dt = now_s.replace(hour=hour, minute=minute, second=0, microsecond=0)
        missed = 0 <= (now_s - sched_dt).total_seconds() <= 7200
        if missed:
            for task in tasks:
                key = f"{task}_{now_s.strftime('%Y-%m-%d')}_{hour}:{minute:02d}"
                if last_run.get(task) != key:
                    last_run[task] = key
                    log.info(f"[startup] догоняю пропущенную задачу: {task}")
                    if task == "warmup_morning":
                        asyncio.create_task(task_warmup("morning"))
                    elif task == "warmup_afternoon":
                        asyncio.create_task(task_warmup("afternoon"))
                    elif task == "warmup_evening":
                        asyncio.create_task(task_warmup("evening"))
                    elif task == "inter_chat":
                        asyncio.create_task(task_inter_chat())
                    elif task == "sender":
                        asyncio.create_task(task_sender())



    async def proxy_health_loop():
        """Каждые 5 мин проверяет прокси. Если недоступен — переключает на резервный из пула."""
        await asyncio.sleep(120)
        proxy_fail_count: dict[str, int] = {}

        while running:
            for session in list(clients.keys()):
                acc = accs_map.get(session)
                if not acc:
                    continue

                original_proxy = acc.get("proxy")
                current_proxy  = proxy_overrides.get(session, original_proxy)

                # Нет прокси — проверяем вернулся ли оригинальный
                if not current_proxy:
                    if original_proxy:
                        host_o, port_o = original_proxy[1], original_proxy[2]
                        if await check_proxy_tcp(host_o, port_o):
                            log.info(f"[proxy] {session[-12:]}: прокси {host_o} восстановлен — возвращаю")
                            db_log(session, "proxy_up", f"{host_o}:{port_o}")
                            proxy_overrides.pop(session, None)
                            if session in clients:
                                cl, _ = clients.pop(session)
                                try: await cl.disconnect()
                                except Exception: pass
                            await connect_one(acc)
                    continue

                host, port = current_proxy[1], current_proxy[2]
                ok = await check_proxy_tcp(host, port)
                fail_key = f"{session}:{host}"

                if ok:
                    proxy_fail_count.pop(fail_key, None)
                    continue

                proxy_fail_count[fail_key] = proxy_fail_count.get(fail_key, 0) + 1
                log.warning(f"[proxy] {session[-12:]}: {host}:{port} не отвечает ({proxy_fail_count[fail_key]}/2)")

                if proxy_fail_count[fail_key] < 2:
                    continue  # Ждём вторую проверку (~10 мин) чтобы не дёргать при кратком сбое

                proxy_fail_count.pop(fail_key, None)
                spare = None
                try:
                    _sc = sqlite3.connect(DB_PATH, timeout=20)
                    _sr = _sc.execute(
                        "SELECT protocol, host, port, username, password FROM proxies "
                        "WHERE assigned_to IS NULL AND active=1 ORDER BY RANDOM() LIMIT 1"
                    ).fetchone()
                    if _sr:
                        spare = [_sr[0], _sr[1], _sr[2], True, _sr[3], _sr[4]]
                        _sc.execute("UPDATE proxies SET assigned_to=? WHERE host=? AND port=?",
                                    (session, _sr[1], _sr[2]))
                        # Освобождаем прокси, который только что признан мёртвым (host/port) —
                        # неважно исходный он из accounts.json или уже был предыдущей заменой,
                        # иначе он остаётся висеть "занятым" в базе навсегда.
                        _sc.execute(
                            "UPDATE proxies SET assigned_to=NULL WHERE host=? AND port=? AND assigned_to=?",
                            (host, port, session))
                    _sc.commit()
                    _sc.close()
                except Exception as _pe:
                    log.warning(f"[proxy] ошибка поиска резерва: {_pe}")

                proxy_overrides[session] = spare
                if session in clients:
                    cl, _ = clients.pop(session)
                    try: await cl.disconnect()
                    except Exception: pass

                if spare:
                    log.info(f"[proxy] {session[-12:]}: {host} → резерв {spare[1]}")
                    db_log(session, "proxy_down", f"{host}:{port} → {spare[1]}")
                    await connect_one({**acc, "proxy": spare})
                else:
                    log.warning(f"[proxy] {session[-12:]}: {host} упал, резервов нет → в спячку до появления прокси")
                    db_log(session, "proxy_down", f"{host}:{port} → спячка")

            await asyncio.sleep(300)

    async def session_backup_loop():
        """Ежедневный бэкап session-файлов в sessions_backup/."""
        import shutil, time as _time
        BACKUP_DIR = OUTREACH_DIR / "sessions_backup"
        BACKUP_DIR.mkdir(exist_ok=True)
        await asyncio.sleep(3600)
        while running:
            try:
                ts = datetime.now(timezone.utc).strftime("%Y%m%d")
                backed = 0
                for sf in OUTREACH_DIR.glob("manager_*.session"):
                    dest = BACKUP_DIR / f"{sf.stem}_{ts}.session"
                    shutil.copy2(sf, dest)
                    backed += 1
                cutoff = _time.time() - 7 * 86400
                for old_f in BACKUP_DIR.glob("*.session"):
                    if old_f.stat().st_mtime < cutoff:
                        old_f.unlink()
                log.info(f"[backup] сессий сохранено: {backed}")
            except Exception as _be:
                log.warning(f"[backup] ошибка: {_be}")
            await asyncio.sleep(86400)

    await asyncio.gather(
        scheduler(),
        keepalive(),
        sync_loop(),
        health_loop(),
        auto_resume_loop(),
        reconnect_loop(),
        *([poll_operator()] if _GROUP in (None, 0) else []),  # только одна группа поллит оператор-бот
        poll_pending_sends(),  # все группы обрабатывают отложенные отправки
        proxy_health_loop(),
        session_backup_loop(),
    )

    for client, _ in clients.values():
        try:
            await client.disconnect()
        except Exception:
            pass
    log.info("Демон остановлен")


# ── PID-файл: защита от двойного запуска ─────────────────────────────────────
_pid_file = PID_FILE
if _pid_file.exists():
    try:
        _old_pid = int(_pid_file.read_text().strip())
        os.kill(_old_pid, 0)
        print(f"[FATAL] Демон уже запущен (PID {_old_pid}). Выход.", flush=True)
        sys.exit(1)
    except ProcessLookupError:
        pass  # старый PID мёртв — перезаписываем
    except ValueError:
        pass
_pid_file.write_text(str(os.getpid()))
import atexit
atexit.register(lambda: _pid_file.unlink(missing_ok=True))

try:
    asyncio.run(main())
except (KeyboardInterrupt, asyncio.CancelledError):
    pass
