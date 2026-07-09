import json
import os
import random
from datetime import datetime, timezone, timedelta
from urllib import request as urllib_request

LLM_API_KEY  = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_MODEL    = os.environ.get("LLM_MODEL", "openai/gpt-4o-mini")

MINI_APP_URL = os.environ.get("MINI_APP_URL", "https://t.me/kitaiservice_bot/app")
MANAGER_GENDER = os.environ.get("MANAGER_GENDER", "female")  # female | male

MINI_APP_LINK_VARIANTS = [
    (
        "Отлично!\n\n"
        "Чтобы подготовить расчет, мы сделали небольшой квиз. Он займет около 3 минут.\n\n"
        "По вашим ответам бот рассчитает предварительную стоимость доставки и подберет оптимальный вариант.\n\n"
        f"👉 {MINI_APP_URL}"
    ),
    (
        "Отлично!\n\n"
        "Для расчета стоимости доставки нужно ответить всего на несколько вопросов. Мы собрали их в удобном боте, поэтому заполнение займет около 3 минут.\n\n"
        "После этого вы получите предварительный расчет стоимости доставки.\n\n"
        f"👉 {MINI_APP_URL}"
    ),
]

NOT_INTERESTED_VARIANTS = [
    "Хорошо, спасибо за ответ.\n\nЕсли в будущем понадобится расчет доставки или таможенное оформление, обращайтесь. Будем рады помочь.",
    "Спасибо за ответ.\n\nЕсли вопрос доставки из Китая станет актуален, обращайтесь.",
]

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
    today_msk = datetime.now(MSK).strftime("%Y-%m-%d")
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mini_app_link = random.choice(MINI_APP_LINK_VARIANTS)
    not_interested = random.choice(NOT_INTERESTED_VARIANTS)
    if MANAGER_GENDER == "male":
        gender_rules = (
            'Ты мужчина. ОБЯЗАТЕЛЬНО пиши только от мужского рода.\n'
            'Правильно: "понял", "рад", "написал", "готов", "уточнил", "хорошего вечера", "увидел".\n'
            'Запрещено: "поняла", "рада", "написала", "готова", "уточнила", "хорошего дня" (если сейчас не день).'
        )
    else:
        gender_rules = (
            'Ты девушка. ОБЯЗАТЕЛЬНО пиши только от женского рода.\n'
            'Правильно: "поняла", "рада", "написала", "готова", "уточнила", "хорошего вечера", "увидела".\n'
            'Запрещено: "понял", "рад", "написал", "готов", "уточнил", "хорошего дня" (если сейчас не день).'
        )
    return f"""Ты менеджер KitaiService — сервиса доставки товаров из Китая (Taobao/1688/Pinduoduo) под ключ.
{name_line}
{gender_rules}

Сейчас: {tod} по Москве, дата {today_msk} (МСК). Прощаясь, используй подходящее: "хорошего утра" / "хорошего дня" / "хорошего вечера".

Ты отвечаешь человеку, которому мы написали первым.
Ниже — вся история переписки с этим человеком, каждое сообщение с датой и временем.
Таймстампы в истории — в UTC (сегодняшняя дата по UTC: {today_utc}).
ВАЖНО: если в истории уже есть приветствие ("добрый день/вечер/утро", "привет" и т.п.) от нашего лица
с сегодняшней датой — НЕ здоровайся снова, отвечай сразу по существу. Здороваться заново можно только
если последнее сообщение было в другой день или переписки/приветствия ещё не было вовсе.

Если человек проявляет интерес к доставке из Китая — твой ответ должен быть:

"{mini_app_link}"

Если человек задаёт уточняющие вопросы — кратко ответь и предложи ссылку на квиз.
Если человек не интересуется — твой ответ должен быть:

"{not_interested}"

Если непонятно — задай 1 вопрос: актуален ли вопрос доставки/выкупа из Китая.

Правила:
- Не продавай в лоб. Не пиши "наши цены", "мы сделаем лучше всех".
- Коротко. Максимум 3-4 предложения.
- Без канцелярита и корпоративных клише.
"""


def generate_draft(history: list, manager_name: str = "") -> str:
    system_prompt = _build_system_prompt(manager_name)
    lines = []
    for m in history:
        role = "Мы" if m.get("direction") == "out" else "Человек"
        sent_at = m.get("sent_at") or ""
        lines.append(f"[{sent_at}] {role}: {m.get('text') or ''}")
    context = "История переписки:\n" + "\n".join(lines)
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
