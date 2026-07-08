import asyncio, hashlib, json, os, shutil, sqlite3, sys, qrcode
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
    """Детерминированно выбирает устройство по хэшу сессии — всегда одно и то же."""
    idx = int(hashlib.md5(session_name.encode()).hexdigest(), 16) % len(_DEVICES)
    model, sysver, appver = _DEVICES[idx]
    return {"device_model": model, "system_version": sysver, "app_version": appver}

async def reauth(session_name):
    accs = json.loads((OUTREACH_DIR / 'accounts.json').read_text())
    acc  = next((a for a in accs if a['session'] == session_name), None)
    if not acc:
        print(f'❌ {session_name} не найден'); return

    from telethon import TelegramClient
    from telethon.errors import SessionPasswordNeededError

    tmp_path = str(TMP_DIR / session_name)
    png_path = f'/tmp/qr_{session_name}.png'
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

    for attempt in range(10):
        try:
            qr_login = await client.qr_login()
            qr = qrcode.QRCode(border=1)
            qr.add_data(qr_login.url)
            qr.make(fit=True)
            qr.make_image().save(png_path)
            print(f'QR готов (попытка {attempt+1}): {png_path}')

            try:
                await qr_login.wait(30)
                break
            except asyncio.TimeoutError:
                print('  QR истёк, обновляю...')
                continue
            except SessionPasswordNeededError:
                if not TWO_FA_PASSWORD:
                    print('  ❌ Нужен 2FA-пароль, но TWO_FA_PASSWORD не задан в .env')
                    return
                print('  2FA...')
                await client.sign_in(password=TWO_FA_PASSWORD)
                break
        except Exception as e:
            print(f'  Ошибка: {e}')
            await asyncio.sleep(2)

    me = await client.get_me()
    if me:
        print(f'АВТОРИЗОВАН: {me.first_name} {me.last_name or ""} ({session_name})')
        await client.disconnect()
        shutil.copy2(tmp_path + '.session', str(OUTREACH_DIR / (session_name + '.session')))

        conn = sqlite3.connect(DB_PATH, timeout=20)
        conn.execute("UPDATE accounts SET status='active' WHERE session=?", (session_name,))
        conn.commit(); conn.close()

        # Сохраняем device params в accounts.json — daemon будет подключаться с теми же params
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

async def reauth_with_lock(session_name):
    lock = Path(f"/tmp/qr_lock_{session_name}")
    lock.touch()
    print(f"[lock] создан — демон не будет подключать этот аккаунт")
    try:
        await asyncio.sleep(12)
        await reauth(session_name)
    finally:
        lock.unlink(missing_ok=True)
        print(f"[lock] снят")

asyncio.run(reauth_with_lock(sys.argv[1]))
