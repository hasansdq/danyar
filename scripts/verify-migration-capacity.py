#!/usr/bin/env python3
"""اعمال امن مایگریشن 20261013150000_classroom_capacity روی کپی DB و سپس مقایسه"""
import sqlite3, shutil, sys, os

BASE = '/home/z/my-project'
SRC = f'{BASE}/db/custom.db'
TEST = f'{BASE}/tool-results/capacity-test.db'
MIG = f'{BASE}/prisma/migrations/20261013150000_classroom_capacity/migration.sql'

os.makedirs(f'{BASE}/tool-results', exist_ok=True)
if os.path.exists(TEST):
    os.remove(TEST)
shutil.copy2(SRC, TEST)

def tables_counts(path):
    con = sqlite3.connect(path)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations'")]
    counts = {}
    for t in tables:
        counts[t] = cur.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
    con.close()
    return counts

before = tables_counts(SRC)

# ۱) اعمال مایگریشن روی کپی
con = sqlite3.connect(TEST)
sql = open(MIG).read()
con.executescript(sql)
con.commit()

# ثبت در _prisma_migrations (مثل prisma migrate deploy)
if con.execute("SELECT count(*) FROM sqlite_master WHERE name='_prisma_migrations'").fetchone()[0]:
    import hashlib
    checksum = hashlib.sha256(sql.encode()).hexdigest()
    con.execute("""
    INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
    VALUES (lower(hex(randomblob(16))), ?, strftime('%Y-%m-%d %H:%M:%f','now'), '20261013150000_classroom_capacity', NULL, NULL, strftime('%Y-%m-%d %H:%M:%f','now'), 1)
    """, (checksum,))
con.commit()

# ۲) اعتبارسنجی
cur = con.cursor()
ok = cur.execute('PRAGMA integrity_check').fetchone()[0]
fk = cur.execute('PRAGMA foreign_key_check').fetchall()
cols = [r[1] for r in cur.execute('PRAGMA table_info("Classroom")')]
mig_reg = cur.execute("SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261013150000_classroom_capacity'").fetchone()[0]
con.close()

after = tables_counts(TEST)

errors = []
if ok != 'ok':
    errors.append(f'integrity: {ok}')
if fk:
    errors.append(f'fk violations: {len(fk)}')
if 'capacity' not in cols:
    errors.append('capacity column missing')
if mig_reg != 1:
    errors.append(f'migration registered: {mig_reg}')
if before != after:
    diffs = {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)}
    errors.append(f'row count changed: {diffs}')

# ۳) تست مقدار null پیش‌فرض
con = sqlite3.connect(TEST)
cap_all_null = con.execute('SELECT count(*) FROM Classroom WHERE capacity IS NOT NULL').fetchone()[0]
n_class = con.execute('SELECT count(*) FROM Classroom').fetchone()[0]
con.close()
print(f'classrooms={n_class} capacity_nonnull={cap_all_null}')

if errors:
    print('FAIL:'); [print(' -', e) for e in errors]; sys.exit(1)
print(f'PASS — integrity ok, {len(after)} tables equal, capacity column added, migration registered')
