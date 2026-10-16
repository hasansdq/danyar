#!/usr/bin/env python3
"""اعمال مایگریشن capacity روی دیتابیس واقعی توسعه (پس از تست موفق روی کپی)"""
import sqlite3, hashlib, shutil, os, sys

BASE = '/home/z/my-project'
DB = f'{BASE}/db/custom.db'
MIG = f'{BASE}/prisma/migrations/20261013150000_classroom_capacity/migration.sql'

# پشتیبان فوری
shutil.copy2(DB, f'{BASE}/db/custom.pre-capacity.db')

con = sqlite3.connect(DB, timeout=30)
cols = [r[1] for r in con.execute('PRAGMA table_info("Classroom")')]
if 'capacity' in cols:
    print('capacity already exists — skip')
    sys.exit(0)

sql = open(MIG).read()
con.executescript(sql)
checksum = hashlib.sha256(sql.encode()).hexdigest()
con.execute("""
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
VALUES (lower(hex(randomblob(16))), ?, strftime('%Y-%m-%d %H:%M:%f','now'), '20261013150000_classroom_capacity', NULL, NULL, strftime('%Y-%m-%d %H:%M:%f','now'), 1)
""", (checksum,))
con.commit()

ok = con.execute('PRAGMA integrity_check').fetchone()[0]
n = con.execute('SELECT count(*) FROM Classroom').fetchone()[0]
reg = con.execute("SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261013150000_classroom_capacity'").fetchone()[0]
con.close()
print(f'integrity={ok} classrooms={n} registered={reg}')
sys.exit(0 if ok == 'ok' and reg == 1 else 1)
