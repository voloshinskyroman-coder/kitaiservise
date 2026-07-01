"""
Получение api_id и api_hash для нового аккаунта через my.telegram.org

Использование:
    python3 get_api_creds.py +79XXXXXXXXX

Алгоритм:
    1. Запрашиваем код на номер через my.telegram.org
    2. Пользователь вводит код из Telegram
    3. Логинимся, пробуем создать приложение
    4. Если Telegram отказывает (аккаунт слишком новый/ограниченный) —
       берём api_id/hash от любого уже рабочего аккаунта из accounts.json
       (это допустимо: api_id/hash идентифицируют приложение, не аккаунт)
"""

import sys, json, os, re, time, requests
from pathlib import Path

ACCOUNTS_FILE = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent) / "accounts.json"
FALLBACK_API_ID   = 2040
FALLBACK_API_HASH = "b18441a1ff607e10a989891a5462e627"  # дефолтный Telethon

def get_fallback_creds() -> tuple[int, str]:
    """Берём api_id/hash от первого рабочего аккаунта в accounts.json."""
    if ACCOUNTS_FILE.exists():
        accs = json.loads(ACCOUNTS_FILE.read_text())
        for a in accs:
            if a.get("api_id") and a.get("api_hash") and a.get("api_id") != 2040:
                return int(a["api_id"]), a["api_hash"]
    return FALLBACK_API_ID, FALLBACK_API_HASH


def get_api_creds(phone: str) -> tuple[int, str]:
    """
    Получает api_id и api_hash для номера через my.telegram.org.
    Возвращает (api_id, api_hash).
    """
    phone = phone.lstrip("+")

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0",
        "Origin":  "https://my.telegram.org",
        "Referer": "https://my.telegram.org/",
    })

    # ── Шаг 1: запросить код ──────────────────────────────────────────────────
    print(f"[api_creds] Запрашиваю код для +{phone}...")
    s.get("https://my.telegram.org/")
    r = s.post("https://my.telegram.org/auth/send_password", data={"phone": phone})

    if r.status_code != 200 or "random_hash" not in r.text:
        print(f"[api_creds] Ошибка запроса кода: {r.text[:200]}")
        print("[api_creds] Использую fallback api_id/hash от существующего аккаунта")
        return get_fallback_creds()

    random_hash = r.json()["random_hash"]
    print(f"[api_creds] Код отправлен в Telegram. random_hash={random_hash}")

    # ── Шаг 2: ввод кода ─────────────────────────────────────────────────────
    code = input("[api_creds] Введи код из Telegram: ").strip()

    # ── Шаг 3: логин ─────────────────────────────────────────────────────────
    r = s.post("https://my.telegram.org/auth/login", data={
        "phone": phone, "random_hash": random_hash, "password": code,
    })
    if r.text.strip() != "true":
        print(f"[api_creds] Логин не удался: {r.text[:200]}")
        print("[api_creds] Использую fallback")
        return get_fallback_creds()

    print("[api_creds] Логин успешен")
    stel_token = s.cookies.get("stel_token", "")
    print(f"[api_creds] stel_token: {stel_token[:20]}...")

    # ── Шаг 4: получить или создать приложение ────────────────────────────────
    r2 = s.get("https://my.telegram.org/apps")

    if "Create new application" in r2.text:
        print("[api_creds] Приложения нет — создаю...")
        form_hash = re.search(r'name="hash" value="([^"]*)"', r2.text)
        if not form_hash:
            print("[api_creds] Не нашёл form_hash — использую fallback")
            return get_fallback_creds()

        created = False
        for shortname in [f"ksv{phone[-6:]}", "kitaiservice1", "ksdelivery01", "ksapp2026", "ksv2026app"]:
            rc = s.post("https://my.telegram.org/apps/create", data={
                "hash":          form_hash.group(1),
                "app_title":     "KitaiService",
                "app_shortname": shortname,
                "app_url":       "",
                "app_platform":  "android",
                "app_desc":      "",
            }, headers={
                "X-Requested-With": "XMLHttpRequest",
                "Referer":           "https://my.telegram.org/apps",
                "Content-Type":      "application/x-www-form-urlencoded; charset=UTF-8",
            })
            print(f"[api_creds]   shortname={shortname}: {rc.text}")
            if rc.text.strip() == "OK":
                created = True
                break
            time.sleep(0.5)

        if not created:
            # Telegram блокирует создание для новых/ограниченных аккаунтов —
            # используем api_id/hash от существующего аккаунта.
            # Это нормально: api_id/hash = идентификатор приложения, а не аккаунта.
            print("[api_creds] Создать приложение не удалось — аккаунт ограничен Telegram")
            print("[api_creds] Беру api_id/hash от существующего аккаунта (это допустимо)")
            return get_fallback_creds()

        r2 = s.get("https://my.telegram.org/apps")

    # ── Шаг 5: парсим api_id и api_hash ──────────────────────────────────────
    m_id   = re.search(r"<strong>(\d+)</strong>", r2.text)
    m_hash = re.search(r"[a-f0-9]{32}", r2.text)

    if m_id and m_hash:
        api_id   = int(m_id.group(1))
        api_hash = m_hash.group(0)
        print(f"\n[api_creds] ✅ api_id:   {api_id}")
        print(f"[api_creds] ✅ api_hash: {api_hash}")
        return api_id, api_hash

    print("[api_creds] Не удалось спарсить api_id/hash — использую fallback")
    return get_fallback_creds()


if __name__ == "__main__":
    phone = sys.argv[1] if len(sys.argv) > 1 else input("Номер телефона (+7XXXXXXXXXX): ")
    api_id, api_hash = get_api_creds(phone)
    print(f"\nРезультат:")
    print(f"  api_id:   {api_id}")
    print(f"  api_hash: {api_hash}")
