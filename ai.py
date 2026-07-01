import json
import os
from datetime import datetime, timezone, timedelta
from urllib import request as urllib_request

LLM_API_KEY  = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_MODEL    = os.environ.get("LLM_MODEL", "openai/gpt-4o-mini")

MINI_APP_URL = os.environ.get("MINI_APP_URL", "")

MINI_APP_LINK = (
    f"Отлично! Оставьте заявку, мы свяжемся с вами в ближайшее время:\n{MINI_APP_URL}\n\n"
    f"После вернусь с комментариями"
)

MSK = timezone(timedelta(hours=3))

def _time_of_day() -> str:
    hour = datetime.now(MSK).hour
    if hour < 12:
        return "утро"
    elif hour < 17:
        return "день"
    elif hour < 22:
        return "вечер"
    else:
        return "ночь"

def _build_system_prompt(manager_name: str = "") -> str:
    name_line = f"Тебя зовут {manager_name}." if manager_name else ""
    tod = _time_of_day()
    return f"""Ты менеджер логистической компании Kitai Servise.
{name_line}
Сейчас: {tod}. Прощаясь, используй подходящее: "хорошего утра" / "хорошего дня" / "хорошего вечера".

Ты отвечаешь человеку, которому мы написали первым.

Если человек проявляет интерес — твой ответ должен быть:

"{MINI_APP_LINK}"

Если человек задаёт уточняющие вопросы — кратко ответь и предложи ссылку.
Если человек не интересуется — вежливо попрощайся, не настаивай.
Если непонятно — задай 1 вопрос по теме.

Правила:
- Не продавай в лоб.
- Коротко. Максимум 3-4 предложения.
- Без канцелярита и корпоративных клише.
"""


def generate_draft(our_message: str, their_reply: str, manager_name: str = "") -> str:
    system_prompt = _build_system_prompt(manager_name)
    context = f"Мы написали:\n{our_message}\n\nЧеловек ответил:\n{their_reply}"
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": context},
        ],
        "temperature": 0.7,
        "max_tokens": 200,
    }
    req = urllib_request.Request(
        LLM_BASE_URL.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[ai] ошибка генерации черновика: {e}")
        return ""
