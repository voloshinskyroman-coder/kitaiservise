"""
Мультиаккаунтная рассылка.
Читает accounts.json, последовательно отправляет от каждого аккаунта.
Добавить аккаунт = одна строчка в accounts.json.
"""
import asyncio
import json
import os
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path

MSK = timezone(timedelta(hours=3))
SEND_HOUR_START = 11
SEND_HOUR_END   = 21

def is_send_time() -> bool:
    return SEND_HOUR_START <= datetime.now(MSK).hour < SEND_HOUR_END

def seconds_until_send_window() -> int:
    now = datetime.now(MSK)
    if now.hour < SEND_HOUR_START:
        target = now.replace(hour=SEND_HOUR_START, minute=0, second=0, microsecond=0)
    else:
        target = (now + timedelta(days=1)).replace(hour=SEND_HOUR_START, minute=0, second=0, microsecond=0)
    return max(0, int((target - now).total_seconds()))

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError, PeerFloodError,
    UserPrivacyRestrictedError, InputUserDeactivatedError,
    UserIsBlockedError, UsernameNotOccupiedError, UsernameInvalidError,
)

from db import (
    init_db, upsert_account, pause_account, resume_account,
    sent_today, sent_this_hour, get_pending_contacts,
    mark_contact, add_message, get_account,
    increment_flood_count, reset_flood_count, mark_account_dead,
)

ACCOUNTS_FILE = Path(__file__).parent / "accounts.json"
_msg_file = os.environ.get("OUTREACH_MESSAGE_FILE", "")
MESSAGE_TEMPLATE = open(_msg_file).read().strip() if _msg_file and os.path.exists(_msg_file) else os.environ.get("OUTREACH_MESSAGE", "")
DAILY_LIMIT  = int(os.environ.get("OUTREACH_DAILY_LIMIT",  "4"))
HOURLY_LIMIT = int(os.environ.get("OUTREACH_HOURLY_LIMIT", "1"))
DELAY_MIN    = float(os.environ.get("OUTREACH_DELAY_MIN",  "120"))
DELAY_MAX    = float(os.environ.get("OUTREACH_DELAY_MAX",  "300"))


def build_message(template: str, first_name: str, gender: str) -> str:
    uvidel = "Увидела" if gender == "female" else "Увидел"
    reshil = "решила"  if gender == "female" else "решил"
    hour   = datetime.now(MSK).hour
    privet = "Добрый вечер" if hour >= 18 else "Добрый день"
    return (template
        .replace("{ИМЯ_АККАУНТА}", first_name)
        .replace("{УВИДЕЛ}", uvidel)
        .replace("{РЕШИЛ}", reshil)
        .replace("{ПРИВЕТСТВИЕ}", privet)
    )


async def send_batch(client: TelegramClient, account_id: int, message_text: str):
    contacts = get_pending_contacts(account_id, limit=300)
    if not contacts:
        print(f"[sender] нет новых контактов для аккаунта {account_id}")
        return

    print(f"[sender] контактов в очереди: {len(contacts)}")

    for contact in contacts:
        if not is_send_time():
            wait = seconds_until_send_window()
            print(f"[sender] нерабочее время, жду {wait // 3600}ч {(wait % 3600) // 60}мин")
            await asyncio.sleep(wait)

        acc = get_account_by_id(account_id)
        if acc and acc["status"] == "paused":
            until = acc.get("paused_until")
            if until and datetime.fromisoformat(until) > datetime.now():
                wait = int((datetime.fromisoformat(until) - datetime.now()).total_seconds())
                print(f"[sender] аккаунт на паузе, жду {wait}с")
                await asyncio.sleep(wait)
                resume_account(account_id)

        if sent_today(account_id) >= DAILY_LIMIT:
            print(f"[sender] дневной лимит {DAILY_LIMIT} достигнут для аккаунта {account_id}")
            break

        if sent_this_hour(account_id) >= HOURLY_LIMIT:
            print(f"[sender] часовой лимит {HOURLY_LIMIT}, жду 15 мин")
            await asyncio.sleep(900)
            continue

        cid    = contact["id"]
        tg_id  = contact["tg_id"]
        uname  = contact.get("username")
        target = f"@{uname}" if uname else int(tg_id)

        try:
            msg = await client.send_message(target, message_text)
            add_message(cid, account_id, "out", message_text, msg.id)
            mark_contact(cid, "sent", account_id)
            reset_flood_count(account_id)
            print(f"[sender] ✅ {target}")

        except FloodWaitError as e:
            print(f"[sender] FloodWait {e.seconds}с")
            pause_account(account_id, e.seconds + 60)
            await asyncio.sleep(e.seconds + 60)
            resume_account(account_id)
            continue

        except PeerFloodError:
            flood_n = increment_flood_count(account_id)
            _delays = [3*3600, 6*3600, 12*3600, 24*3600]
            _delay  = _delays[min(flood_n - 1, len(_delays) - 1)]
            if flood_n >= 4:
                mark_account_dead(account_id)
                print(f"[sender] {session}: PeerFlood #{flood_n} -> DEAD")
            else:
                pause_account(account_id, _delay)
                print(f"[sender] {session}: PeerFlood #{flood_n} — пауза {_delay//3600}ч")
            break

        except (UserPrivacyRestrictedError, UserIsBlockedError):
            mark_contact(cid, "skipped")
            print(f"[sender] ⏭️  {target} — приватность/блок")

        except (InputUserDeactivatedError, UsernameNotOccupiedError, UsernameInvalidError):
            mark_contact(cid, "failed")
            print(f"[sender] ❌ {target} — не существует")

        except Exception as e:
            mark_contact(cid, "failed")
            print(f"[sender] ❌ {target} — {e}")

        delay = random.uniform(DELAY_MIN, DELAY_MAX)
        print(f"[sender] жду {delay:.0f}с...")
        await asyncio.sleep(delay)


def get_account_by_id(account_id: int) -> dict | None:
    from db import get_conn
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        return dict(row) if row else None


async def run():
    init_db()

    if not ACCOUNTS_FILE.exists():
        raise FileNotFoundError(f"accounts.json не найден: {ACCOUNTS_FILE}")
    accounts = json.loads(ACCOUNTS_FILE.read_text())
    print(f"[sender] загружено аккаунтов: {len(accounts)}")

    if not MESSAGE_TEMPLATE:
        raise ValueError("OUTREACH_MESSAGE_FILE не задан или файл пуст")

    for acc_cfg in accounts:
        session  = acc_cfg["session"]
        api_id   = acc_cfg["api_id"]
        api_hash = acc_cfg["api_hash"]
        gender   = acc_cfg.get("gender", "female")

        print(f"\n[sender] === аккаунт: {session} ===")
        account_id = upsert_account(session, DAILY_LIMIT, HOURLY_LIMIT)

        acc = get_account_by_id(account_id)
        if acc and acc["status"] == "paused":
            until = acc.get("paused_until")
            if until and datetime.fromisoformat(until) > datetime.now():
                print(f"[sender] аккаунт на паузе до {until}, пропускаем")
                continue

        if sent_today(account_id) >= DAILY_LIMIT:
            print(f"[sender] дневной лимит уже достигнут, пропускаем")
            continue

        proxy = acc_cfg.get("proxy")
        proxy_arg = tuple(proxy) if proxy else None
        client = TelegramClient(
            str(Path(__file__).parent / session), api_id, api_hash, proxy=proxy_arg
        )
        try:
            await client.start()
            me = await client.get_me()
            print(f"[sender] аккаунт: +{me.phone} ({me.first_name})")
            message_text = build_message(MESSAGE_TEMPLATE, me.first_name or "", gender)
            await send_batch(client, account_id, message_text)
        except Exception as e:
            print(f"[sender] ошибка аккаунта {session}: {e}")
            import traceback; traceback.print_exc()
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass

    print("\n[sender] === все аккаунты обработаны ===")


if __name__ == "__main__":
    asyncio.run(run())
