import os
import sqlite3
from pathlib import Path

OUTREACH_DIR = Path(os.environ.get("OUTREACH_DIR") or Path(__file__).parent)

conn = sqlite3.connect(str(OUTREACH_DIR / "outreach.db"))
conn.row_factory = sqlite3.Row

contacts = conn.execute("""
    SELECT c.id, c.username, COUNT(m.id) as total
    FROM contacts c
    JOIN messages m ON m.contact_id = c.id AND m.direction = 'out'
    GROUP BY c.id
    HAVING total > 1
""").fetchall()

print(f'Контактов с дублями: {len(contacts)}')

for contact in contacts:
    cid = contact['id']
    username = contact['username']

    msgs = conn.execute("""
        SELECT m.id, m.account_id, m.sent_at, COALESCE(a.session, 'unknown') as session
        FROM messages m
        LEFT JOIN accounts a ON a.id = m.account_id
        WHERE m.contact_id = ? AND m.direction = 'out'
        ORDER BY m.sent_at ASC
    """, (cid,)).fetchall()

    keep_id = msgs[0]['id']
    first_account = msgs[0]['account_id']
    delete_ids = [m['id'] for m in msgs[1:]]
    placeholders = ','.join(['?' for _ in delete_ids])

    print(f'@{username}: оставляю msg#{keep_id} ({msgs[0]["session"][-10:]}), удаляю {len(delete_ids)} дублей')

    conn.execute('DELETE FROM messages WHERE id IN (' + placeholders + ')', delete_ids)
    conn.execute('UPDATE contacts SET account_id = ? WHERE id = ?', (first_account, cid))

conn.commit()
conn.close()
print('Done')
