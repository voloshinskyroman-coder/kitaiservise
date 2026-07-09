import asyncio, hashlib, json, os, shutil, sqlite3, sys
from pathlib import Path

_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

OUTREACH_DIR    = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent)
DB_PATH         = str(OUTREACH_DIR / 'outreach.db')
TMP_DIR         = Path('/tmp/qr_reauth'); TMP_DIR.mkdir(exist_ok=True)
TWO_FA_PASSWORD = os.environ.get('TWO_FA_PASSWORD', '')

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

def _assign_device(session_name: str) -> dict:
    idx = int(hashlib.md5(session_name.encode()).hexdigest(), 16) % len(_DEVICES)
    model, sysver, appver = _DEVICES[idx]
    return {"device_model": model, "system_version": sysver, "app_version": appver}

async def code_login(session_name: str, code_file: str):
    accs = json.loads((OUTREACH_DIR / 'accounts.json').read_text())
    acc  = next((a for a in accs if a['session'] == session_name), None)
    if not acc:
        print(f'❌ {session_name} не найден'); return

    from telethon import TelegramClient
    from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError

    tmp_path = str(TMP_DIR / session_name)
    device = _assign_device(session_name)
    client = TelegramClient(
        tmp_path, acc['api_id'], acc['api_hash'],
        device_model=device['device_model'],
        system_version=device['system_version'],
        app_version=device['app_version'],
        lang_code='ru',
        system_lang_code='ru-RU',
    )
    await client.connect()
    print(f"[device] {device['device_model']} / {device['system_version']}")

    sent = await client.send_code_request(acc['phone'])
    print(f"[code] отправлен на {acc['phone']}, жду файл {code_file}")

    code = None
    for _ in range(300):  # до 10 минут
        p = Path(code_file)
        if p.exists():
            code = p.read_text().strip()
            p.unlink(missing_ok=True)
            break
        await asyncio.sleep(2)

    if not code:
        print("❌ Код не получен за 10 минут")
        await client.disconnect()
        return

    try:
        await client.sign_in(acc['phone'], code, phone_code_hash=sent.phone_code_hash)
    except SessionPasswordNeededError:
        if not TWO_FA_PASSWORD:
            print('❌ Нужен 2FA-пароль, но TWO_FA_PASSWORD не задан в .env')
            return
        print('  2FA...')
        await client.sign_in(password=TWO_FA_PASSWORD)
    except PhoneCodeInvalidError:
        print('❌ Неверный код')
        await client.disconnect()
        return

    me = await client.get_me()
    if me:
        print(f'АВТОРИЗОВАН: {me.first_name} {me.last_name or ""} ({session_name})')
        await client.disconnect()
        shutil.copy2(tmp_path + '.session', str(OUTREACH_DIR / (session_name + '.session')))

        conn = sqlite3.connect(DB_PATH, timeout=20)
        conn.execute(
            "INSERT INTO accounts (session, phone, status, daily_limit, hourly_limit) VALUES (?, ?, 'active', 50, 8) "
            "ON CONFLICT(session) DO UPDATE SET status='active'",
            (session_name, acc['phone'])
        )
        conn.commit(); conn.close()

        accs_path = OUTREACH_DIR / 'accounts.json'
        accs = json.loads(accs_path.read_text())
        for a in accs:
            if a['session'] == session_name:
                a['device_model']    = device['device_model']
                a['system_version']  = device['system_version']
                a['app_version']     = device['app_version']
                break
        accs_path.write_text(json.dumps(accs, ensure_ascii=False, indent=2))
        print(f"[device saved] {device['device_model']} → accounts.json")
        print('DONE')
    else:
        print('НЕ АВТОРИЗОВАН')
        await client.disconnect()

async def code_login_with_lock(session_name: str, code_file: str):
    lock = Path(f"/tmp/qr_lock_{session_name}")
    lock.touch()
    print(f"[lock] создан — демон не будет подключать этот аккаунт")
    try:
        await asyncio.sleep(12)
        await code_login(session_name, code_file)
    finally:
        lock.unlink(missing_ok=True)
        print(f"[lock] снят")

asyncio.run(code_login_with_lock(sys.argv[1], sys.argv[2]))
