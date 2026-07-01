import json
import os
import socket as _socket
from urllib import request as urllib_request

# Принудительно IPv4 — у сервера нет глобального IPv6,
# но DNS отдаёт оба адреса. Python пробует IPv6 первым → ENETUNREACH.
_orig_getaddrinfo = _socket.getaddrinfo
def _ipv4_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    results = _orig_getaddrinfo(host, port, family, type, proto, flags)
    return sorted(results, key=lambda r: r[0] != _socket.AF_INET)
_socket.getaddrinfo = _ipv4_only_getaddrinfo

BOT_TOKEN     = os.environ["OPERATOR_BOT_TOKEN"]
OPERATOR_ID   = int(os.environ["OPERATOR_USER_ID"])


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def bot_api(method: str, payload: dict, retries: int = 3) -> dict:
    import time
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    for attempt in range(retries):
        req = urllib_request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib_request.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"[operator_bot] {method} error: {e} — {body}")
            return {}
        except Exception as e:
            print(f"[operator_bot] {method} error (attempt {attempt+1}): {e}")
            if attempt < retries - 1:
                time.sleep(2)
    return {}


def get_updates(offset: int) -> list[dict]:
    r = bot_api("getUpdates", {"offset": offset, "timeout": 3, "limit": 20})
    return r.get("result", [])


def answer_cb(cb_id: str, text: str):
    bot_api("answerCallbackQuery", {"callback_query_id": cb_id, "text": text})


def remove_buttons(message_id: int):
    bot_api("editMessageReplyMarkup", {
        "chat_id": OPERATOR_ID,
        "message_id": message_id,
        "reply_markup": {"inline_keyboard": []},
    })


def notify_reply(conv_id: int, username: str | None, tg_id: str,
                 our_msg: str, their_reply: str, ai_draft: str,
                 manager_name: str | None = None, manager_phone: str | None = None) -> int:
    name = f"@{username}" if username else f"tg_id:{tg_id}"
    manager_line = ""
    if manager_name or manager_phone:
        parts = []
        if manager_name: parts.append(manager_name)
        if manager_phone: parts.append(manager_phone)
        manager_line = f"\n👩 <b>Менеджер:</b> {_esc(' · '.join(parts))}"
    text = (
        f"💬 <b>Новый ответ</b>\n\n"
        f"👤 {_esc(name)}{manager_line}\n\n"
        f"📨 <b>Мы написали:</b>\n<i>{_esc(our_msg[:300])}</i>\n\n"
        f"💬 <b>Ответил:</b>\n<i>{_esc(their_reply[:300])}</i>\n\n"
        f"🤖 <b>Черновик ответа:</b>\n{_esc(ai_draft)}"
    )
    result = bot_api("sendMessage", {
        "chat_id": OPERATOR_ID,
        "text": text,
        "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": [[
            {"text": "✅ Отправить",  "callback_data": f"send:{conv_id}"},
            {"text": "✏️ Изменить",  "callback_data": f"edit:{conv_id}"},
            {"text": "❌ Пропустить", "callback_data": f"skip:{conv_id}"},
        ]]},
    })
    return result.get("result", {}).get("message_id", 0)


def notify_sent(username: str | None, tg_id: str, text: str):
    name = f"@{username}" if username else f"tg_id:{tg_id}"
    bot_api("sendMessage", {
        "chat_id": OPERATOR_ID,
        "text": f"✅ Отправлено {_esc(name)}:\n\n{_esc(text)}",
        "parse_mode": "HTML",
    })
