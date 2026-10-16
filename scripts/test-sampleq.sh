#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست جامع کتابخانه نمونه‌سؤالات دانیار (مرحله ۹)
# دسترسی نقش‌محور، اعتبارسنجی فایل سمت سرور، چندکلاسه مستقل از گروه درسی،
# اعلان انتشار ضدتکرار، پیام خودکار گروهی ضدتکرار، نشان‌گذاری، جایگزینی امن فایل،
# فیلتر و مدیریت مدیر مدرسه، صفحه‌بندی و گیت امکانات
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-sq
mkdir -p $J

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar $4=realm(optional)
  local realm="${4:-app}"
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"$realm\"}" > /dev/null
}
code() { curl -s -b $J/$1.jar -o $J/out.json -w "%{http_code}" "${@:2}"; }
codeanon() { curl -s -o $J/out.json -w "%{http_code}" "$@"; }
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
# کوئری مستقیم دیتابیس — عبارت از متغیر محیطی (سازگار با bun -e)
dbq() { DBQ="$1" bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const r=await eval('(async()=>('+process.env.DBQ+'))()');console.log(r);await db.\$disconnect()" 2>/dev/null; }

SQ_RUN=$(date +%s)

# ── ساخت فایل‌های آزمون واقعی ──
python3 - <<'PYEOF'
import zipfile, base64, os
# PDF واقعی مینیمال
pdf = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Size 4/Root 1 0 R>>
%%EOF"""
open('/tmp/sq-test.pdf','wb').write(pdf)
open('/tmp/sq-test2.pdf','wb').write(pdf + b'\n% variant2')
# PNG واقعی 1x1
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
open('/tmp/sq-test.png','wb').write(png)
open('/tmp/sq-test2.png','wb').write(png + b'\x00variant')
# DOCX واقعی (zip) با ساختار حداقلی
with zipfile.ZipFile('/tmp/sq-test.docx','w') as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/plain"/></Types>')
open('/tmp/sq-bad.txt','w').write('not allowed')
open('/tmp/sq-bad.zip','w').write('not allowed')
os.system('dd if=/dev/zero of=/tmp/sq-big.pdf bs=1M count=21 2>/dev/null')
PYEOF

# ── پاک‌سازی داده‌های اجراهای قبلی (قابل اجرای مجدد) ──
bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
await db.sampleQuestionBookmark.deleteMany({})
await db.sampleQuestionFile.deleteMany({})
await db.sampleQuestionClass.deleteMany({})
await db.sampleQuestion.deleteMany({})
await db.notification.deleteMany({where:{type:'SAMPLEQ_NEW'}})
await db.message.deleteMany({where:{type:'SAMPLEQ'}})
await db.upload.deleteMany({where:{uploader:{role:'TEACHER'}, createdAt:{lt:new Date(Date.now()-60000)}}})
await db.\$disconnect()
console.log('cleaned')
" > /dev/null 2>&1 && ok "پاک‌سازی داده‌های آزمون قبلی" || bad "پاک‌سازی"

say "ورود کاربران"
login beheshti.t1 Pass@123 t1 && ok "معلم t1 (ریاضی هفتم۱+هشتم۱)"
login beheshti.t2 Pass@123 t2 && ok "معلم t2 (علوم)"
login beheshti.t3 Pass@123 t3 && ok "معلم t3 (ادبیات — فقط هفتم۱)"
login beheshti.s1 Pass@123 s1 && ok "دانش‌آموز s1 (هفتم۱)"
login beheshti.s2 Pass@123 s2 && ok "دانش‌آموز s2 (هفتم۱)"
login beheshti.s5 Pass@123 s5 && ok "دانش‌آموز s5 (هشتم۱)"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱"
login farzanegan.t1 Pass@123 ft1 && ok "معلم مدرسه ۲"
login farzanegan.admin Pass@123 fadmin && ok "مدیر مدرسه ۲"
login superadmin Admin@1234 sa superadmin && ok "مدیر کل"

# شناسه‌های دمو
CLASS7=$(dbq "db.classroom.findFirst({where:{name:'هفتم۱'}}).then(c=>c.id)")
CLASS8=$(dbq "db.classroom.findFirst({where:{name:'هشتم۱'}}).then(c=>c.id)")
T1ID=$(dbq "db.user.findUnique({where:{username:'beheshti.t1'}}).then(u=>u.id)")
T2ID=$(dbq "db.user.findUnique({where:{username:'beheshti.t2'}}).then(u=>u.id)")
S1ID=$(dbq "db.user.findUnique({where:{username:'beheshti.s1'}}).then(u=>u.id)")
GROUPMATH7=$(dbq "db.subjectGroup.findFirst({where:{name:'ریاضی هفتم۱'}}).then(g=>g.id)")
GROUPSCI8=$(dbq "db.subjectGroup.findFirst({where:{classroomId:'$CLASS8'}}).then(g=>g.id)")
SCHOOL1=$(dbq "db.classroom.findUnique({where:{id:'$CLASS7'}}).then(c=>c.schoolId)")
echo "  (CLASS7=$CLASS7 GROUPMATH7=$GROUPMATH7)"

# ─────────────────────────────────────────────
say "احراز هویت و گیت نقش‌ها"
C=$(codeanon $BASE/api/sample-questions); [ "$C" = "401" ] && ok "بدون نشست → 401" || bad "بدون نشست: $C"
C=$(code s1 $BASE/api/sample-questions/classes); [ "$C" = "403" ] && ok "دانش‌آموز classes → 403" || bad "دانش‌آموز classes: $C"
C=$(code s1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d '{}'); [ "$C" = "403" ] && ok "دانش‌آموز ایجاد → 403" || bad "دانش‌آموز ایجاد: $C"
C=$(code s1 $BASE/api/sample-questions); [ "$C" = "200" ] && ok "دانش‌آموز فهرست → 200" || bad "دانش‌آموز فهرست: $C"

say "کلاس‌های مجاز بر اساس نقش"
code t1 $BASE/api/sample-questions/classes
N=$(json "len(d['classrooms'])"); G=$(json "len(d['groups'])")
[ "$N" = "2" ] && ok "t1 دو کلاس دید (هفتم۱+هشتم۱)" || bad "t1 کلاس‌ها: $N"
[ "$G" -ge 2 ] && ok "t1 گروه‌های کلاس‌هایش را دید ($G گروه)" || bad "t1 گروه‌ها: $G"
code t3 $BASE/api/sample-questions/classes
N=$(json "len(d['classrooms'])")
[ "$N" = "1" ] && ok "t3 فقط یک کلاس دید" || bad "t3 کلاس‌ها: $N"
code admin1 $BASE/api/sample-questions/classes
N=$(json "len(d['classrooms'])")
[ "$N" -ge 2 ] && ok "admin1 همه کلاس‌های مدرسه را دید ($N)" || bad "admin1 کلاس‌ها: $N"
code ft1 $BASE/api/sample-questions/classes
HAS=$(json "any('هفتم' in c['name'] for c in d['classrooms'])")
[ "$HAS" = "False" ] && ok "ft1 (مدرسه ۲) کلاس مدرسه ۱ را ندید" || bad "نشت کلاس بین مدارس"

say "اعتبارسنجی آپلود (سمت سرور)"
C=$(code s1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.pdf;type=application/pdf" -F "purpose=sampleq"); [ "$C" = "403" ] && ok "دانش‌آموز آپلود sampleq → 403" || bad "دانش‌آموز آپلود: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.pdf;type=application/pdf" -F "purpose=sampleq")
[ "$C" = "201" ] && QPDF=$(json "d['key']") && ok "آپلود PDF → 201" || bad "آپلود PDF: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.png;type=image/png" -F "purpose=sampleq")
[ "$C" = "201" ] && QPNG=$(json "d['key']") && ok "آپلود تصویر → 201" || bad "آپلود تصویر: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" -F "purpose=sampleq")
[ "$C" = "201" ] && ok "آپلود Word (docx) → 201" || bad "آپلود docx: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-bad.txt;type=text/plain" -F "purpose=sampleq"); [ "$C" = "415" ] && ok "فایل txt → 415" || bad "txt: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-bad.zip;type=application/zip" -F "purpose=sampleq"); [ "$C" = "415" ] && ok "فایل zip → 415" || bad "zip: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-big.pdf;type=application/pdf" -F "purpose=sampleq"); [ "$C" = "413" ] && ok "فایل ۲۱ مگابایتی → 413" || bad "بزرگ: $C"

say "اعتبارسنجی ایجاد نمونه‌سؤال"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"\",\"subject\":\"ریاضی\",\"classIds\":[\"$CLASS7\"]}"); [ "$C" = "400" ] && ok "عنوان خالی → 400" || bad "عنوان خالی: $C"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"تست\",\"subject\":\"ریاضی\",\"classIds\":[]}"); [ "$C" = "400" ] && ok "بدون کلاس → 400" || bad "بدون کلاس: $C"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d '{"title":"تست","subject":"ریاضی","classIds":["fake-id-xyz"]}'); [ "$C" = "404" ] && ok "کلاس ناموجود → 404" || bad "کلاس ناموجود: $C"
C=$(code t3 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"تست\",\"subject\":\"ادبیات\",\"classIds\":[\"$CLASS8\"]}"); [ "$C" = "403" ] && ok "کلاس غیرمجاز معلم → 403" || bad "کلاس غیرمجاز: $C"

say "ایجاد منتشرشده با فایل + پیام گروهی + اعلان"
CREATE_BODY="{\"clientId\":\"sq-run-$SQ_RUN-1\",\"title\":\"آزمون میان‌ترم ریاضی\",\"subject\":\"ریاضی\",\"topic\":\"معادله درجه دوم\",\"description\":\"نمونه سوالات میان‌ترم با پاسخ تشریحی\",\"classIds\":[\"$CLASS7\"],\"showAnswer\":false,\"status\":\"PUBLISHED\",\"questionFiles\":[{\"key\":\"$QPDF\"}],\"answerFiles\":[{\"key\":\"$QPNG\"}],\"sendToGroup\":{\"groupId\":\"$GROUPMATH7\"}}"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "$CREATE_BODY")
[ "$C" = "201" ] && Q1=$(json "d['id']") && ok "ایجاد نمونه‌سؤال منتشرشده → 201 ($Q1)" || { bad "ایجاد: $C"; cat $J/out.json; echo; }
MC=$(dbq "db.message.count({where:{subjectGroupId:'$GROUPMATH7',type:'SAMPLEQ',sampleQuestionId:'$Q1'}})")
[ "$MC" = "1" ] && ok "دقیقاً یک پیام خودکار در گروه" || bad "پیام گروه: $MC"

N1=$(dbq "db.notification.count({where:{userId:'$S1ID',type:'SAMPLEQ_NEW'}})")
[ "$N1" = "1" ] && ok "اعلان انتشار برای s1 → دقیقاً ۱" || bad "اعلان s1: $N1"
N2=$(dbq "db.notification.count({where:{type:'SAMPLEQ_NEW',user:{username:'beheshti.s2'}}})")
[ "$N2" = "1" ] && ok "اعلان برای s2 → دقیقاً ۱" || bad "اعلان s2: $N2"
N5=$(dbq "db.notification.count({where:{type:'SAMPLEQ_NEW',user:{username:'beheshti.s5'}}})")
[ "$N5" = "0" ] && ok "بدون اعلان برای s5 (کلاس مخاطب نیست)" || bad "اعلان s5: $N5"
LNK=$(dbq "db.notification.findFirst({where:{type:'SAMPLEQ_NEW'}}).then(n=>n.link)")
[ "$LNK" = "/sample-questions/$Q1" ] && ok "لینک اعلان به صفحه نمونه‌سؤال" || bad "لینک اعلان: $LNK"
GM=$(dbq "db.message.findFirst({where:{sampleQuestionId:'$Q1'}}).then(m=>db.notification.count({where:{type:'GROUP_MESSAGE',dedupeKey:'msg:'+m.id}}))")
[ "$GM" = "0" ] && ok "پیام خودکار نمونه‌سؤال اعلان GROUP_MESSAGE نداشت (بدون تکرار)" || bad "اعلان تکراری پیام خودکار: $GM"

say "تلاش مجدد ایجاد — بدون تکرار"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "$CREATE_BODY")
D=$(json "d.get('duplicate')"); ID2=$(json "d['id']")
[ "$C" = "200" ] && [ "$D" = "True" ] && [ "$ID2" = "$Q1" ] && ok "تلاش مجدد → همان نمونه‌سؤال (duplicate)" || bad "تلاش مجدد: $C $ID2"
MC=$(dbq "db.message.count({where:{subjectGroupId:'$GROUPMATH7',type:'SAMPLEQ',sampleQuestionId:'$Q1'}})")
[ "$MC" = "1" ] && ok "پیام گروهی همچنان ۱ (ضدتکرار)" || bad "پیام پس از تلاش مجدد: $MC"
N1=$(dbq "db.notification.count({where:{userId:'$S1ID',type:'SAMPLEQ_NEW'}})")
[ "$N1" = "1" ] && ok "اعلان s1 همچنان ۱ (ضدتکرار)" || bad "اعلان پس از تلاش مجدد: $N1"

say "پیش‌نویس و گروه نامعتبر"
ND_BASE=$(dbq "db.notification.count({where:{type:'SAMPLEQ_NEW'}})")
[ -n "$ND_BASE" ] && ok "پایه اعلان‌ها قبل از پیش‌نویس: $ND_BASE" || bad "شمارش پایه اعلان"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"پیش‌نویس آزمون\",\"subject\":\"ریاضی\",\"classIds\":[\"$CLASS7\"],\"status\":\"UNPUBLISHED\"}")
[ "$C" = "201" ] && QDRAFT=$(json "d['id']") && ok "ایجاد پیش‌نویس → 201" || bad "پیش‌نویس: $C"
ND=$(dbq "db.notification.count({where:{type:'SAMPLEQ_NEW'}})")
[ "$ND" = "$ND_BASE" ] && ok "پیش‌نویس اعلانی نساخت (کل اعلان‌ها همچنان $ND)" || bad "اعلان پیش‌نویس: $ND ≠ پایه $ND_BASE"
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"تست گروه\",\"subject\":\"ریاضی\",\"classIds\":[\"$CLASS7\"],\"sendToGroup\":{\"groupId\":\"$GROUPSCI8\"}}")
W=$(json "d.get('warning','')")
[ "$C" = "201" ] && [ -n "$W" ] && ok "گروه خارج از کلاس‌های مخاطب → warning بدون پیام" || bad "گروه خارج کلاس: $C W=$W"
C=$(code t3 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"تست t3\",\"subject\":\"ادبیات\",\"classIds\":[\"$CLASS7\"]}")
[ "$C" = "201" ] && ok "t3 نمونه‌سؤال کلاس خودش را ساخت" || bad "t3 ایجاد: $C"

say "نمایش نقش‌محور"
code s1 $BASE/api/sample-questions
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])"); HASD=$(json "any(q['id']=='$QDRAFT' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "s1 نمونه‌سؤال منتشرشده را دید" || bad "s1 ندید"
[ "$HASD" = "False" ] && ok "s1 پیش‌نویس را ندید" || bad "s1 پیش‌نویس دید!"
code s5 $BASE/api/sample-questions
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])")
[ "$HAS" = "False" ] && ok "s5 (کلاس دیگر) ندید" || bad "s5 دید!"
code s1 $BASE/api/sample-questions/$Q1
QF=$(json "len(d['questionFiles'])"); AF=$(json "len(d['answerFiles'])"); AH=$(json "d['answerHidden']")
[ "$QF" = "1" ] && ok "s1 فایل سؤال را در جزئیات دید ($QF)" || bad "فایل سؤال s1: $QF"
[ "$AF" = "0" ] && [ "$AH" = "True" ] && ok "پاسخ‌نامه برای s1 پنهان (نمایش غیرفعال)" || bad "پاسخ‌نامه s1: $AF $AH"
TN=$(json "d['teacherName']")
[ -n "$TN" ] && ok "نام معلم نمایش داده شد ($TN)" || bad "نام معلم خالی"
C=$(code ft1 $BASE/api/sample-questions/$Q1); [ "$C" = "404" ] && ok "معلم مدرسه ۲ → 404" || bad "ft1 detail: $C"
C=$(code t2 $BASE/api/sample-questions/$Q1); [ "$C" = "404" ] && ok "معلم غیرسازنده همان مدرسه → 404" || bad "t2 detail: $C"
code admin1 $BASE/api/sample-questions/$Q1
[ "$(json "len(d['audiences'])")" = "1" ] && ok "admin1 مخاطبان را دید" || bad "audiences"
S1IN=$(json "any(s['fullName'] for s in d['audiences'][0]['students'])")
[ "$S1IN" = "True" ] && ok "فهرست دانش‌آموزان مخاطب شامل s1" || bad "students"

say "دسترسی فایل‌ها"
QFILE_URL=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q1',role:'QUESTION'}}).then(f=>'/api/sample-questions/$Q1/files/'+f.id)")
AFILE_URL=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q1',role:'ANSWER'}}).then(f=>'/api/sample-questions/$Q1/files/'+f.id)")
C=$(code s1 $BASE$QFILE_URL); [ "$C" = "200" ] && ok "s1 فایل سؤال → 200" || bad "فایل سؤال s1: $C"
CT=$(curl -s -b $J/s1.jar -o $J/pdfdl.bin -w "%{content_type}" $BASE$QFILE_URL)
head -c4 $J/pdfdl.bin | rg -q "%PDF" && ok "محتوای دانلودشده PDF واقعی" || bad "محتوای PDF خراب"
C=$(code s1 $BASE$AFILE_URL); [ "$C" = "404" ] && ok "s1 فایل پاسخ‌نامه پنهان → 404" || bad "پاسخ‌نامه s1: $C"
C=$(code admin1 $BASE$AFILE_URL); [ "$C" = "200" ] && ok "admin1 فایل پاسخ‌نامه → 200" || bad "پاسخ‌نامه admin1: $C"
C=$(codeanon $BASE$QFILE_URL); [ "$C" = "401" ] && ok "دانلود بدون نشست → 401" || bad "بدون نشست فایل: $C"
C=$(code ft1 $BASE$QFILE_URL); [ "$C" = "404" ] && ok "دانلود از مدرسه دیگر → 404" || bad "ft1 فایل: $C"

say "کلید نمایش پاسخ‌نامه"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"showAnswer":true}'); [ "$C" = "200" ] && ok "t1 فعال‌کردن نمایش پاسخ‌نامه" || bad "PATCH showAnswer: $C"
C=$(code s1 $BASE$AFILE_URL); [ "$C" = "200" ] && ok "s1 حالا پاسخ‌نامه را دانلود کرد → 200" || bad "s1 پاسخ‌نامه فعال: $C"
code s1 $BASE/api/sample-questions/$Q1
[ "$(json "len(d['answerFiles'])")" = "1" ] && ok "فایل پاسخ‌نامه در جزئیات s1 ظاهر شد" || bad "answerFiles فعال"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"showAnswer":false}')
C=$(code s1 $BASE$AFILE_URL); [ "$C" = "404" ] && ok "غیرفعال‌سازی → دوباره 404 برای s1" || bad "s1 پس از غیرفعال: $C"

say "ویرایش کلاس‌ها و اعلان بدون تکرار"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d "{\"classIds\":[\"$CLASS7\",\"$CLASS8\"]}")
[ "$C" = "200" ] && ok "افزودن کلاس هشتم۱" || bad "افزودن کلاس: $C"
N5=$(dbq "db.notification.count({where:{type:'SAMPLEQ_NEW',user:{username:'beheshti.s5'},dedupeKey:'sampleq:$Q1'}})")
[ "$N5" = "1" ] && ok "s5 (کلاس جدید) حالا یک اعلان دارد" || bad "اعلان s5: $N5"
N1=$(dbq "db.notification.count({where:{userId:'$S1ID',type:'SAMPLEQ_NEW',dedupeKey:'sampleq:$Q1'}})")
[ "$N1" = "1" ] && ok "s1 همچنان فقط ۱ اعلان (بدون تکرار)" || bad "اعلان s1 تکرار: $N1"
C=$(code s5 $BASE/api/sample-questions/$Q1); [ "$C" = "200" ] && ok "s5 حالا جزئیات را می‌بیند" || bad "s5 detail: $C"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d "{\"classIds\":[\"$CLASS7\"]}")
C=$(code s5 $BASE/api/sample-questions/$Q1); [ "$C" = "404" ] && ok "حذف کلاس → s5 دسترسی از دست داد" || bad "s5 پس از حذف کلاس: $C"

say "جایگزینی امن فایل (جداسازی بین نمونه‌سؤال‌ها)"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test2.pdf;type=application/pdf" -F "purpose=sampleq") && QPDF2=$(json "d['key']")
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test2.png;type=image/png" -F "purpose=sampleq") && QPNG2=$(json "d['key']")
C=$(code t1 -X POST $BASE/api/sample-questions -H 'content-type: application/json' -d "{\"title\":\"آزمون خرداد\",\"subject\":\"ریاضی\",\"classIds\":[\"$CLASS7\"],\"questionFiles\":[{\"key\":\"$QPDF2\"}],\"answerFiles\":[{\"key\":\"$QPNG2\"}]}")
[ "$C" = "201" ] && Q2=$(json "d['id']") && ok "نمونه‌سؤال دوم با فایل‌های خودش" || bad "Q2: $C"
Q2FILE_URL=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q2',role:'QUESTION'}}).then(f=>'/api/sample-questions/$Q2/files/'+f.id)")
OLD_Q1_FILE=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q1',role:'QUESTION'}}).then(f=>f.id)")
# فایل تازه برای جایگزینی در Q1 (کلیدها یکتا هستند)
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.pdf;type=application/pdf" -F "purpose=sampleq") && QPDF3=$(json "d['key']")
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"keepQuestionFileIds":[],"questionFiles":[{"key":"'$QPDF3'"}]}')
[ "$C" = "200" ] && ok "جایگزینی فایل سؤال Q1" || bad "جایگزینی Q1: $C"
C=$(code t1 $BASE/api/sample-questions/$Q1/files/$OLD_Q1_FILE); [ "$C" = "404" ] && ok "فایل قدیمی Q1 حذف شد (404)" || bad "فایل قدیمی Q1: $C"
C=$(code t1 $BASE$Q2FILE_URL); [ "$C" = "200" ] && ok "فایل Q2 دست‌نخورده ماند (جداسازی)" || bad "فایل Q2 آسیب: $C"
NEW_Q1_FILE=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q1',role:'QUESTION'}}).then(f=>f.id)")
C=$(code t1 $BASE/api/sample-questions/$Q1/files/$NEW_Q1_FILE); [ "$C" = "200" ] && ok "فایل جدید Q1 درج شد" || bad "فایل جدید Q1: $C"

say "چرخه انتشار/لغو انتشار"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"status":"UNPUBLISHED"}')
C=$(code s1 $BASE/api/sample-questions/$Q1); [ "$C" = "404" ] && ok "لغو انتشار → s1 دیگر دسترسی ندارد" || bad "s1 پس از لغو: $C"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"status":"PUBLISHED"}')
N1=$(dbq "db.notification.count({where:{userId:'$S1ID',type:'SAMPLEQ_NEW',dedupeKey:'sampleq:$Q1'}})")
[ "$N1" = "1" ] && ok "انتشار دوباره → اعلان تکراری نشد" || bad "اعلان انتشار دوباره: $N1"

say "مدیریت مدیر مدرسه"
C=$(code admin1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"status":"UNPUBLISHED"}')
[ "$C" = "200" ] && ok "admin1 لغو انتشار → 200" || bad "admin1 unpublish: $C"
C=$(code s1 $BASE/api/sample-questions/$Q1); [ "$C" = "404" ] && ok "s1 پس از لغو مدیر → 404" || bad "s1: $C"
C=$(code admin1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"title":"هک"}')
[ "$C" = "403" ] && ok "admin1 تغییر محتوا → 403 (فقط لغو انتشار)" || bad "admin1 محتوا: $C"
C=$(code t1 -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"status":"PUBLISHED"}')
C=$(code fadmin -X PATCH $BASE/api/sample-questions/$Q1 -H 'content-type: application/json' -d '{"status":"UNPUBLISHED"}')
[ "$C" = "404" ] && ok "مدیر مدرسه ۲ → 404" || bad "fadmin: $C"

say "فیلترهای مدیر"
code admin1 -G "$BASE/api/sample-questions" --data-urlencode "status=UNPUBLISHED"
HAS=$(json "any(q['id']=='$QDRAFT' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "فیلتر وضعیت=پیش‌نویس" || bad "فیلتر وضعیت"
code admin1 -G "$BASE/api/sample-questions" --data-urlencode "subject=ریاضی"
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])"); CNT=$(json "all(q['subject']=='ریاضی' for q in d['questions'])")
[ "$HAS" = "True" ] && [ "$CNT" = "True" ] && ok "فیلتر درس=ریاضی" || bad "فیلتر درس"
code admin1 "$BASE/api/sample-questions?teacherId=$T2ID"
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])")
[ "$HAS" = "False" ] && ok "فیلتر معلم t2 → Q1 نیست" || bad "فیلتر معلم"
code admin1 "$BASE/api/sample-questions?teacherId=$T1ID"
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "فیلتر معلم t1 → Q1 هست" || bad "فیلتر معلم t1"
code admin1 -G "$BASE/api/sample-questions" --data-urlencode "classId=$CLASS7" --data-urlencode "q=خرداد"
HAS=$(json "any(q['id']=='$Q2' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "فیلتر کلاس + جست‌وجوی عنوان" || bad "فیلتر کلاس+q"
code s1 -G "$BASE/api/sample-questions" --data-urlencode "q=معادله"
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "جست‌وجوی موضوع برای دانش‌آموز" || bad "جست‌وجوی موضوع"

say "نشان‌گذاری"
C=$(code s1 -X POST $BASE/api/sample-questions/$Q1/bookmark); [ "$C" = "201" ] && ok "s1 نشان‌گذاری → 201" || bad "bookmark: $C"
C=$(code s1 -X POST $BASE/api/sample-questions/$Q1/bookmark)
[ "$C" = "200" ] && [ "$(json "d.get('duplicate')")" = "True" ] && ok "نشان تکراری → duplicate" || bad "نشان تکراری: $C"
code s1 "$BASE/api/sample-questions?bookmarked=1"
HAS=$(json "any(q['id']=='$Q1' for q in d['questions'])")
[ "$HAS" = "True" ] && ok "فهرست نشان‌دارها شامل Q1" || bad "فهرست نشان‌دار"
C=$(code s5 -X POST $BASE/api/sample-questions/$Q1/bookmark); [ "$C" = "404" ] && ok "نشان‌گذاری نمونه‌سؤال غیرمجاز → 404" || bad "s5 bookmark: $C"
C=$(code t1 -X POST $BASE/api/sample-questions/$Q1/bookmark); [ "$C" = "403" ] && ok "معلم نشان‌گذاری → 403 (مخصوص دانش‌آموز)" || bad "t1 bookmark: $C"
C=$(code s1 -X DELETE $BASE/api/sample-questions/$Q1/bookmark); [ "$C" = "200" ] && ok "حذف نشان" || bad "حذف نشان: $C"
code s1 "$BASE/api/sample-questions?bookmarked=1"
N=$(json "len(d['questions'])"); [ "$N" = "0" ] && ok "فهرست نشان‌دارها خالی شد" || bad "باقیمانده نشان: $N"

say "حذف با تأیید و جداسازی فایل"
Q2ANS=$(dbq "db.sampleQuestionFile.findFirst({where:{questionId:'$Q2',role:'ANSWER'}}).then(f=>f.id)")
C=$(code ft1 -X DELETE $BASE/api/sample-questions/$Q2); [ "$C" = "404" ] && ok "حذف توسط معلم مدرسه دیگر → 404" || bad "ft1 delete: $C"
C=$(code fadmin -X DELETE $BASE/api/sample-questions/$Q2); [ "$C" = "404" ] && ok "حذف توسط مدیر مدرسه دیگر → 404" || bad "fadmin delete: $C"
C=$(code s1 -X DELETE $BASE/api/sample-questions/$Q2); [ "$C" = "404" ] && ok "حذف توسط دانش‌آموز → 404" || bad "s1 delete: $C"
C=$(code admin1 -X DELETE $BASE/api/sample-questions/$Q2); [ "$C" = "200" ] && ok "admin1 حذف Q2 → 200" || bad "admin1 delete: $C"
C=$(code t1 $BASE$Q2FILE_URL); [ "$C" = "404" ] && ok "فایل Q2 حذف شد" || bad "فایل Q2 پس از حذف: $C"
C=$(code t1 $BASE/api/sample-questions/$Q1/files/$NEW_Q1_FILE); [ "$C" = "200" ] && ok "فایل Q1 سالم ماند" || bad "فایل Q1: $C"

say "صفحه‌بندی تدریجی"
for i in $(seq 1 22); do
  curl -s -b $J/t1.jar -X POST $BASE/api/sample-questions -H 'content-type: application/json' \
    -d "{\"title\":\"بانک تست $SQ_RUN-$i\",\"subject\":\"ریاضی\",\"classIds\":[\"$CLASS7\"],\"status\":\"PUBLISHED\"}" > /dev/null
done
code s1 "$BASE/api/sample-questions?page=1&pageSize=20"
N=$(json "len(d['questions'])"); HM=$(json "d['hasMore']"); T=$(json "d['total']")
[ "$N" = "20" ] && [ "$HM" = "True" ] && ok "صفحه ۱: ۲۰ مورد + hasMore (کل $T)" || bad "صفحه ۱: N=$N HM=$HM"
code s1 "$BASE/api/sample-questions?page=2&pageSize=20"
HM=$(json "d['hasMore']"); N2=$(json "len(d['questions'])")
[ "$HM" = "False" ] && [ "$N2" -ge 3 ] && ok "صفحه ۲: پایان فهرست ($N2 مورد)" || bad "صفحه ۲: HM=$HM N=$N2"
# پاک‌سازی رکوردهای صفحه‌بندی
bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();await db.sampleQuestion.deleteMany({where:{title:{startsWith:'بانک تست'}}});await db.\$disconnect()" > /dev/null 2>&1 && ok "پاک‌سازی داده‌های صفحه‌بندی" || bad "پاک‌سازی صفحه‌بندی"

say "گیت امکانات مدرسه"
FEAT='{"chat":true,"dm":true,"assignments":true,"onlineClass":true,"attendance":true,"sampleq":false}'
C=$(code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d "{\"features\":$FEAT}")
[ "$C" = "200" ] && ok "مدیر کل sampleq را خاموش کرد" || bad "PATCH features: $C"
C=$(code t1 $BASE/api/sample-questions); [ "$C" = "403" ] && ok "معلم فهرست → 403" || bad "t1 گیت: $C"
C=$(code s1 $BASE/api/sample-questions); [ "$C" = "403" ] && ok "دانش‌آموز فهرست → 403" || bad "s1 گیت: $C"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/sq-test.pdf;type=application/pdf" -F "purpose=sampleq"); [ "$C" = "403" ] && ok "آپلود sampleq → 403" || bad "آپلود گیت: $C"
FEAT='{"chat":true,"dm":true,"assignments":true,"onlineClass":true,"attendance":true,"sampleq":true}'
code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d "{\"features\":$FEAT}" > /dev/null
C=$(code t1 $BASE/api/sample-questions); [ "$C" = "200" ] && ok "فعال‌سازی دوباره → 200" || bad "فعال‌سازی: $C"

say "مسیر صفحات"
C=$(curl -s -o /dev/null -w "%{http_code}" $BASE/sample-questions); [ "$C" = "307" ] && ok "/sample-questions بدون نشست → ریدایرکت ورود" || bad "صفحه بدون نشست: $C"
C=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" $BASE/sample-questions); [ "$C" = "200" ] && ok "صفحه نمونه‌سؤالات دانش‌آموز → 200" || bad "صفحه s1: $C"

echo -e "\n════════════════════════════"
echo "نتیجه: $PASS پاس ✅ | $FAIL شکست ❌"
echo "════════════════════════════"
[ "$FAIL" = "0" ] || exit 1
