"""
Импорт базы контактов из xlsx/csv в SQLite.

Поддерживаемые колонки (любой регистр, любой порядок):
  - Telegram ID / tg_id / id
  - Username / username
  - Last Seen / last_seen
  - Status / status
"""
import csv
import sys
from pathlib import Path

import openpyxl

from db import get_conn, init_db


COLUMN_MAP = {
    "telegram id": "tg_id",
    "tg_id": "tg_id",
    "tg id": "tg_id",
    "id": "tg_id",
    "username": "username",
    "last seen": "last_seen",
    "last_seen": "last_seen",
    "status": "status",
}


def _normalize_headers(headers: list[str]) -> list[str]:
    return [COLUMN_MAP.get(h.strip().lower(), None) for h in headers]


def _import_rows(rows: list[dict]) -> tuple[int, int]:
    inserted = skipped = 0
    with get_conn() as conn:
        for row in rows:
            tg_id    = str(row.get("tg_id", "")).strip()
            username = str(row.get("username", "")).strip().lstrip("@") or None
            last_seen = str(row.get("last_seen", "")).strip() or None

            if not tg_id:
                skipped += 1
                continue

            try:
                conn.execute("""
                    INSERT INTO contacts (tg_id, username, last_seen)
                    VALUES (?, ?, ?)
                    ON CONFLICT(tg_id) DO NOTHING
                """, (tg_id, username, last_seen))
                if conn.execute("SELECT changes()").fetchone()[0]:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"  ⚠️  строка пропущена ({tg_id}): {e}")
                skipped += 1
        conn.commit()
    return inserted, skipped


def import_xlsx(path: Path) -> tuple[int, int]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)

    headers = _normalize_headers([str(h) if h else "" for h in next(rows_iter)])

    rows = []
    for raw in rows_iter:
        row = {}
        for key, val in zip(headers, raw):
            if key:
                row[key] = val
        rows.append(row)

    wb.close()
    return _import_rows(rows)


def import_csv(path: Path) -> tuple[int, int]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = _normalize_headers(reader.fieldnames or [])
        rows = []
        for raw in reader:
            row = {}
            for orig, norm in zip(reader.fieldnames, headers):
                if norm:
                    row[norm] = raw.get(orig, "")
            rows.append(row)
    return _import_rows(rows)


def import_file(path: str) -> tuple[int, int]:
    init_db()
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")
    if p.suffix.lower() in (".xlsx", ".xls"):
        return import_xlsx(p)
    elif p.suffix.lower() == ".csv":
        return import_csv(p)
    else:
        raise ValueError(f"Неизвестный формат: {p.suffix}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python importer.py contacts.xlsx")
        sys.exit(1)
    inserted, skipped = import_file(sys.argv[1])
    print(f"✅ Импортировано: {inserted}  |  Пропущено/дубли: {skipped}")
