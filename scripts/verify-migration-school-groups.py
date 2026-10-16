#!/usr/bin/env python3
"""تست مهاجرت 20261013120000 روی کپی دیتابیس واقعی — بدون دست‌زدن به دیتابیس اصلی"""
import sqlite3, shutil, sys, os

SRC = '/home/z/my-project/db/custom.db'
TMP = '/home/z/my-project/.verify-migration/test.db'
MIG = '/home/z/my-project/prisma/migrations/20261013120000_school_groups_grade/migration.sql'
os.makedirs(os.path.dirname(TMP), exist_ok=True)
shutil.copy(SRC, TMP)

db = sqlite3.connect(TMP)
cur = db.cursor()

def q(sql, args=()):
    return cur.execute(sql, args).fetchall()

# وضعیت پیش از مهاجرت
pre = {
    'classrooms': q('SELECT COUNT(*) FROM Classroom')[0][0],
    'subjectgroups': q('SELECT COUNT(*) FROM SubjectGroup')[0][0],
    'messages': q('SELECT COUNT(*) FROM Message')[0][0],
    'overrides': q('SELECT COUNT(*) FROM GroupMemberOverride')[0][0],
    'readstates': q('SELECT COUNT(*) FROM GroupReadState')[0][0],
    'teaching': q('SELECT COUNT(*) FROM TeachingAssignment')[0][0],
    'assignments': q('SELECT COUNT(*) FROM Assignment')[0][0],
    'livesessions': q('SELECT COUNT(*) FROM LiveSession')[0][0],
}
print('PRE :', pre)

sql = open(MIG, encoding='utf-8').read()
cur.executescript(sql)
db.commit()

post = {
    'classrooms': q('SELECT COUNT(*) FROM Classroom')[0][0],
    'subjectgroups': q('SELECT COUNT(*) FROM SubjectGroup')[0][0],
    'messages': q('SELECT COUNT(*) FROM Message')[0][0],
    'overrides': q('SELECT COUNT(*) FROM GroupMemberOverride')[0][0],
    'readstates': q('SELECT COUNT(*) FROM GroupReadState')[0][0],
    'teaching': q('SELECT COUNT(*) FROM TeachingAssignment')[0][0],
    'assignments': q('SELECT COUNT(*) FROM Assignment')[0][0],
    'livesessions': q('SELECT COUNT(*) FROM LiveSession')[0][0],
}
print('POST:', post)

ok = True
for k in pre:
    if pre[k] != post[k]:
        print(f'❌ شمارش {k} تغییر کرد: {pre[k]} → {post[k]}')
        ok = False

# صحت داده‌ها
integrity = q('PRAGMA integrity_check')[0][0]
print('integrity:', integrity)
ok = ok and integrity == 'ok'

fk = q('PRAGMA foreign_key_check')
print('fk_check rows:', len(fk))
ok = ok and len(fk) == 0

# backfill پایه
grades = q('SELECT name, grade FROM Classroom ORDER BY name')
print('کلاس‌ها:', grades)
matched = sum(1 for _, g in grades if g)
print(f'پایه تشخیص‌داده‌شده: {matched}/{len(grades)}')

# ساختار جدید
cols = [r[1] for r in q('PRAGMA table_info(SubjectGroup)')]
need = {'classroomId','schoolId','scope','grade','name','id','messagePolicy','archivedAt'}
missing = need - set(cols)
if missing:
    print('❌ ستون‌های غایب:', missing); ok = False
else:
    print('ستون‌های SubjectGroup:', cols)

# نمونه: scope همه ردیف‌های موجود CLASS
bad_scope = q("SELECT COUNT(*) FROM SubjectGroup WHERE scope != 'CLASS'")[0][0]
print('ردیف‌های non-CLASS (باید ۰ باشد):', bad_scope)
ok = ok and bad_scope == 0

# پیام‌ها همچنان به گروه‌ها وصل‌اند
orphans = q('SELECT COUNT(*) FROM Message m LEFT JOIN SubjectGroup g ON m."subjectGroupId"=g.id WHERE m."subjectGroupId" IS NOT NULL AND g.id IS NULL')[0][0]
print('پیام‌های یتیم:', orphans)
ok = ok and orphans == 0

# شبیه‌سازی درج گروه عمومی (classroomId=null)
cur.execute("INSERT INTO SubjectGroup (id, name, schoolId, scope, grade, messagePolicy, updatedAt) VALUES ('t1','گروه همکاران',(SELECT id FROM School LIMIT 1),'SCHOOL_STAFF',NULL,'ALL','2026-01-01')")
cur.execute("SELECT scope, classroomId FROM SubjectGroup WHERE id='t1'")
print('درج گروه عمومی:', cur.fetchone())
cur.execute("DELETE FROM SubjectGroup WHERE id='t1'")
db.commit()

print('✅ همه بررسی‌ها سبز' if ok else '❌ شکست')
shutil.rmtree(os.path.dirname(TMP), ignore_errors=True)
sys.exit(0 if ok else 1)
