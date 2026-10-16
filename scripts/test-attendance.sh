#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست جامع حضور و غیاب دانیار (مرحله ۸) — تقویم جلالی
# دسترسی نقش‌محور، پیش‌فرض حاضر، نهایی‌سازی و اعلان خصوصی بدون تکرار،
# اصلاح با حفظ سابقه و اعلان اصلاح، ثبت‌نشده جدا از غیبت، پیش‌نویس خارج از آمار،
# جداسازی مدرسه‌ای، گزارش و فیلتر مدیر، خروجی اکسل و گیت امکانات
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-att
mkdir -p $J

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"app\"}" > /dev/null
}
code() { curl -s -b $J/$1.jar -o $J/out.json -w "%{http_code}" "${@:2}"; }
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

# ── پاک‌سازی داده‌های حضور و غیاب اجراهای قبلی (قابل اجرای مجدد) ──
bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
await db.attendanceEditLog.deleteMany()
await db.attendanceRecord.deleteMany()
await db.attendanceSession.deleteMany()
await db.notification.deleteMany({where:{type:{startsWith:'ATTENDANCE'}}})
await db.classroomEnrollment.deleteMany({where:{student:{username:'beheshti.s7'}}})
await db.user.deleteMany({where:{username:'beheshti.s7'}})
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
login superadmin Admin@1234 sa superadmin >/dev/null && curl -s -c $J/sa.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{"username":"superadmin","password":"Admin@1234","realm":"superadmin"}' > /dev/null && ok "مدیر کل"

# شناسه‌های دمو
CLASS7=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const c=await db.classroom.findFirst({where:{name:'هفتم۱'}});console.log(c.id)" 2>/dev/null)
CLASS8=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const c=await db.classroom.findFirst({where:{name:'هشتم۱'}});console.log(c.id)" 2>/dev/null)
T3ID=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const u=await db.user.findUnique({where:{username:'beheshti.t3'}});console.log(u.id)" 2>/dev/null)
S2ID=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const u=await db.user.findUnique({where:{username:'beheshti.s2'}});console.log(u.id)" 2>/dev/null)
GROUPMATH7=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const g=await db.subjectGroup.findFirst({where:{name:'ریاضی هفتم۱'}});console.log(g.id)" 2>/dev/null)

say "کلاس‌های قابل دسترس (بر اساس انتساب واقعی)"
code t1 $BASE/api/attendance/classes > /dev/null
N=$(json "len([c for c in d['classrooms']])"); CNT=$(json "sum(c['studentCount'] for c in d['classrooms'])")
[ "$N" = "2" ] && [ "$CNT" = "6" ] && ok "t1 دو کلاس با ۶ دانش‌آموز دید (هفتم۱+هشتم۱)" || bad "t1 کلاس‌ها نادرست: N=$N CNT=$CNT"
code t3 $BASE/api/attendance/classes > /dev/null
N=$(json "len(d['classrooms'])")
[ "$N" = "1" ] && ok "t3 فقط هفتم۱ را می‌بیند" || bad "t3 تعداد کلاس نادرست: $N"
HTTP_S1=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" $BASE/api/attendance/classes)
[ "$HTTP_S1" = "403" ] && ok "دانش‌آموز ۴۰۳ روی کلاس‌ها" || bad "دانش‌آموز کلاس‌ها: $HTTP_S1"
HTTP_SA=$(curl -s -b $J/sa.jar -o /dev/null -w "%{http_code}" $BASE/api/attendance/classes)
[ "$HTTP_SA" = "403" ] && ok "مدیر کل ۴۰۳ روی حضور و غیاب" || bad "مدیر کل: $HTTP_SA"

say "ایجاد جلسه — پیش‌فرض حاضر برای همه"
HTTP=$(curl -s -b $J/t3.jar -o $J/out.json -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-11-20\"}")
if [ "$HTTP" = "201" ]; then
  TITLE=$(json "d['session']['title']"); NR=$(json "len(d['session']['records'])")
  NP=$(json "len([r for r in d['session']['records'] if r['status']=='PRESENT'])")
  [ "$TITLE" = "جلسه 1" ] && [ "$NR" = "4" ] && [ "$NP" = "4" ] && ok "جلسه خودکار «جلسه ۱» با ۴ رکورد همه حاضر" || bad "پیش‌فرض: $TITLE r=$NR p=$NP"
  ATT1=$(json "d['session']['id']")
else bad "ایجاد جلسه: $HTTP"; fi
# جلسه دوم همان روز با عنوان دیگر
HTTP=$(curl -s -b $J/t3.jar -o $J/out.json -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-11-20\",\"title\":\"زنگ دوم\"}")
[ "$HTTP" = "201" ] && ok "جلسه دوم همان روز با عنوان دیگر ۲۰۱" || bad "جلسه دوم: $HTTP"
ATT_DRAFT2=$(json "d['session']['id']")
# تکرار همان روز با همان عنوان صریح → 409
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-11-20\",\"title\":\"زنگ دوم\"}")
[ "$HTTP" = "409" ] && ok "جلسه تکراری همان روز با همان عنوان ۴۰۹" || bad "تکراری: $HTTP"
# جلسه با چک‌باکس غیبت از همان ایجاد — t1 روی هشتم۱: s5 غایب با یادداشت
S5ID=$(curl -s -b $J/admin1.jar "$BASE/api/attendance/students?classroomId=$CLASS8" | python3 -c "import json,sys;d=json.load(sys.stdin);print([s['id'] for s in d['students'] if 'صابری' in s['fullName']][0])")
HTTP=$(curl -s -b $J/t1.jar -o $J/out.json -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS8\",\"dateKey\":\"1404-11-20\",\"records\":[{\"studentId\":\"$S5ID\",\"status\":\"ABSENT\",\"note\":\"بدون اطلاع\"}]}")
if [ "$HTTP" = "201" ]; then
  ST=$(json "[r['status'] for r in d['session']['records'] if r['studentId']=='$S5ID'][0]")
  NT=$(json "[r['note'] for r in d['session']['records'] if r['studentId']=='$S5ID'][0]")
  [ "$ST" = "ABSENT" ] && [ "$NT" = "بدون اطلاع" ] && ok "ایجاد با غیبت و یادداشت اولیه (بدون لاگ اصلاح)" || bad "غیبت اولیه: $ST/$NT"
  ATT8=$(json "d['session']['id']")
else bad "ایجاد هشتم۱: $HTTP"; fi
HTTP=$(curl -s -b $J/ft1.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-11-20\",\"title\":\"نفوذ\"}")
[ "$HTTP" = "404" ] && ok "جداسازی: معلم مدرسه ۲ روی کلاس مدرسه ۱ → ۴۰۴" || bad "نفوذ معلم خارجی: $HTTP"
# تاریخ نامعتبر
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-13-40\"}")
[ "$HTTP" = "400" ] && ok "تاریخ جلالی نامعتبر ۴۰۰" || bad "تاریخ نامعتبر: $HTTP"
# دانش‌آموز اجازه ایجاد ندارد
HTTP=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/attendance/sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLASS7\",\"dateKey\":\"1404-11-20\"}")
[ "$HTTP" = "403" ] && ok "دانش‌آموز ۴۰۳ روی ایجاد جلسه" || bad "ایجاد دانش‌آموز: $HTTP"

say "دسترسی جزئیات و اعتبارسنجی رکورد"
HTTP=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" $BASE/api/attendance/sessions/$ATT1)
[ "$HTTP" = "404" ] && ok "دانش‌آموز جزئیات جلسه نمی‌بیند (۴۰۴)" || bad "جزئیات دانش‌آموز: $HTTP"
HTTP=$(curl -s -b $J/fadmin.jar -o /dev/null -w "%{http_code}" $BASE/api/attendance/sessions/$ATT1)
[ "$HTTP" = "404" ] && ok "مدیر مدرسه ۲ جلسه مدرسه ۱ را نمی‌بیند (۴۰۴)" || bad "مدیر خارجی: $HTTP"
code t3 $BASE/api/attendance/sessions/$ATT1 > /dev/null
NS=$(json "len(d['students'])")
[ "$NS" = "4" ] && ok "t3 جزئیات با ۴ دانش‌آموز" || bad "تعداد دانش‌آموز جزئیات: $NS"
# رکورد دانش‌آموز خارج از کلاس
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S5ID\",\"status\":\"ABSENT\"}]}")
[ "$HTTP" = "400" ] && ok "رکورد دانش‌آموز غیرعضو کلاس ۴۰۰" || bad "غیرعضو: $HTTP"
# وضعیت نامعتبر
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S2ID\",\"status\":\"LATE\"}]}")
[ "$HTTP" = "400" ] && ok "وضعیت نامعتبر ۴۰۰" || bad "وضعیت نامعتبر: $HTTP"
# دانش‌آموز اجازه ویرایش ندارد — وجود جلسه از او پنهان است (۴۰۴)
HTTP=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S2ID\",\"status\":\"PRESENT\"}]}")
[ "$HTTP" = "404" ] && ok "دانش‌آموز جلسه را اصلاح نمی‌تواند (۴۰۴ پنهان)" || bad "ویرایش دانش‌آموز: $HTTP"

say "پیش از نهایی‌سازی: پیش‌نویس برای دانش‌آموز نامرئی است"
code s1 "$BASE/api/attendance/my" > /dev/null
TOT=$(json "d['stats']['total']")
[ "$TOT" = "0" ] && ok "s1 هیچ سابقه‌ای از پیش‌نویس نمی‌بیند (total=0)" || bad "پیش‌نویس نمایان: $TOT"
# و در آمار مدیر هم نیست
code admin1 "$BASE/api/attendance/report" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "0" ] && ok "گزارش مدیر: جلسه پیش‌نویس محاسبه نمی‌شود (rows=0)" || bad "پیش‌نویس در گزارش: $RC"

say "نهایی‌سازی + اعلان خصوصی بدون تکرار"
# تعداد پیام‌های گروه ریاضی هفتم۱ پیش از نهایی‌سازی (برای اثبات عدم انتشار در گروه)
BEFORE_MSGS=$(curl -s -b $J/t1.jar "$BASE/api/chats/group/$GROUPMATH7/messages" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null)
HTTP=$(curl -s -b $J/t3.jar -o $J/out.json -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d '{"action":"finalize"}')
ST=$(json "d['session']['status']")
[ "$HTTP" = "200" ] && [ "$ST" = "FINALIZED" ] && ok "نهایی‌سازی موفق" || bad "نهایی‌سازی: $HTTP $ST"
# دوباره → 400
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d '{"action":"finalize"}')
[ "$HTTP" = "400" ] && ok "نهایی‌سازی دوباره ۴۰۰" || bad "نهایی‌سازی دوباره: $HTTP"
# اعلان هر ۴ دانش‌آموز — s1
code s1 "$BASE/api/notifications" > /dev/null
NT=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_FINALIZED'])")
[ "$NT" = "1" ] && ok "s1 یک اعلان «حضور و غیاب شما ثبت شد»" || bad "اعلان s1: $NT"
BODY=$(json "[n['body'] for n in d['items'] if n['type']=='ATTENDANCE_FINALIZED'][0]")
echo "$BODY" | grep -q "حاضر" && ok "متن اعلان شامل وضعیت خصوصی خود دانش‌آموز (حاضر)" || bad "متن اعلان: $BODY"
# s5 در جلسه هشتم۱ نهایی نشده — نباید اعلان داشته باشد
code s5 "$BASE/api/notifications" > /dev/null
NT5=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_FINALIZED'])")
[ "$NT5" = "0" ] && ok "s5 هنوز اعلان حضور ندارد (جلسه‌اش پیش‌نویس است)" || bad "اعلان s5: $NT5"
# اثبات عدم انتشار در گروه عمومی
AFTER_MSGS=$(curl -s -b $J/t1.jar "$BASE/api/chats/group/$GROUPMATH7/messages" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null)
[ -n "$BEFORE_MSGS" ] && [ "$BEFORE_MSGS" = "$AFTER_MSGS" ] && ok "هیچ پیامی در گروه عمومی منتشر نشد ($AFTER_MSGS پیام ثابت)" || bad "پیام گروه تغییر کرد: $BEFORE_MSGS → $AFTER_MSGS"

say "سابقه دانش‌آموز پس از نهایی‌سازی"
code s1 "$BASE/api/attendance/my" > /dev/null
TOT=$(json "d['stats']['total']"); PR=$(json "d['stats']['present']")
[ "$TOT" = "1" ] && [ "$PR" = "1" ] && ok "s1 سابقه نهایی: ۱ حاضر" || bad "my: $TOT/$PR"
DN=$(json "d['records'][0]['dateKey']")
[ "$DN" = "1404-11-20" ] && ok "تاریخ جلالی در سابقه: 1404-11-20" || bad "dateKey: $DN"

say "اصلاح پس از نهایی‌سازی — سابقه اصلاحات + اعلان اصلاح"
# t3 وضعیت s1 را غایب می‌کند
HTTP=$(curl -s -b $J/t3.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const u=await db.user.findUnique({where:{username:'beheshti.s1'}});console.log(u.id)")\",\"status\":\"ABSENT\"}]}")
[ "$HTTP" = "200" ] && ok "اصلاح وضعیت پس از نهایی‌سازی ۲۰۰" || bad "اصلاح: $HTTP"
code s1 "$BASE/api/notifications" > /dev/null
NC=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'])")
[ "$NC" = "1" ] && ok "s1 یک اعلان اصلاح" || bad "اصلاح s1: $NC"
BODY=$(json "[n['body'] for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'][0]")
echo "$BODY" | grep -q 'از «حاضر» به «غایب»' && ok "متن اصلاح: از «حاضر» به «غایب»" || bad "متن اصلاح: $BODY"
# تغییر فقط یادداشت → اعلان جدید نمی‌سازد
S1ID=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const u=await db.user.findUnique({where:{username:'beheshti.s1'}});console.log(u.id)")
curl -s -b $J/t3.jar -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"ABSENT\",\"note\":\"غیبت موجه\"}]}" > /dev/null
code s1 "$BASE/api/notifications" > /dev/null
NC2=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'])")
[ "$NC2" = "1" ] && ok "تغییر فقط یادداشت اعلان تکراری نساخت" || bad "اعلان یادداشت: $NC2"
# ذخیره بدون تغییر واقعی → بدون اعلان
curl -s -b $J/t3.jar -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"ABSENT\",\"note\":\"غیبت موجه\"}]}" > /dev/null
code s1 "$BASE/api/notifications" > /dev/null
NC3=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'])")
[ "$NC3" = "1" ] && ok "ذخیره بدون تغییر اعلان نساخت (ضدتکرار)" || bad "ضدتکرار: $NC3"
# تغییر دوم وضعیت: ABSENT→PRESENT → اعلان اصلاح دوم با کلید متفاوت
curl -s -b $J/t3.jar -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S1ID\",\"status\":\"PRESENT\"}]}" > /dev/null
code s1 "$BASE/api/notifications" > /dev/null
NC4=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'])")
[ "$NC4" = "2" ] && ok "تغییر دوم وضعیت → اعلان اصلاح دوم (شماره‌دار)" || bad "اصلاح دوم: $NC4"
# تاریخچه اصلاحات در جزئیات — ۳ ردیف: تغییر وضعیت، تغییر یادداشت، بازگشت وضعیت (همه حفظ می‌شوند)
code t3 $BASE/api/attendance/sessions/$ATT1 > /dev/null
NE=$(json "len(d['edits'])")
[ "$NE" = "3" ] && ok "سابقه اصلاحات جلسه: ۳ ردیف (وضعیت+یادداشت+بازگشت)" || bad "تعداد اصلاحات: $NE"
EN=$(json "d['edits'][0]['editorName']")
[ "$EN" = "حسین کریم‌زاده" ] && ok "نام اصلاح‌کننده در سابقه ذخیره شده" || bad "editor: $EN"

say "مدیر مدرسه: مشاهده، فیلتر، آمار، اصلاح"
# ثبت‌نشده: دانش‌آموز جدید بعداً ثبت‌نام می‌شود
bun -e "
import {PrismaClient} from '@prisma/client'
import bcrypt from 'bcryptjs'
const db=new PrismaClient()
const h=await bcrypt.hash('Pass@123',12)
let u=await db.user.findUnique({where:{username:'beheshti.s7'}})
if(!u) u=await db.user.create({data:{username:'beheshti.s7',passwordHash:h,fullName:'آرش رستمی',role:'STUDENT',schoolId:(await db.school.findFirst({where:{name:'دبیرستان شهید بهشتی'}})).id}})
const c=await db.classroom.findFirst({where:{name:'هفتم۱'}})
const ex=await db.classroomEnrollment.findFirst({where:{studentId:u.id,classroomId:c.id}})
if(!ex) await db.classroomEnrollment.create({data:{studentId:u.id,classroomId:c.id}})
console.log(u.id)
" > /dev/null 2>&1 && ok "دانش‌آموز جدید پس از نهایی‌سازی در کلاس ثبت‌نام شد" || bad "ثبت‌نام s7"
code admin1 "$BASE/api/attendance/report" > /dev/null
RC=$(json "len(d['rows'])")
UN=$(json "len([r for r in d['rows'] if r['status']=='UNSET'])")
AB=$(json "len([r for r in d['rows'] if r['status']=='ABSENT'])")
PR=$(json "len([r for r in d['rows'] if r['status']=='PRESENT'])")
[ "$RC" = "5" ] && [ "$UN" = "1" ] && [ "$AB" = "0" ] && [ "$PR" = "4" ] && ok "گزارش: ۵ ردیف = ۴ حاضر + ۱ ثبت‌نشده (غایب فعلاً صفر)" || bad "گزارش: r=$RC un=$UN ab=$AB pr=$PR"
# فیلتر وضعیت ABSENT → صفر (ثبت‌نشده غایب حساب نمی‌شود)
code admin1 "$BASE/api/attendance/report?status=ABSENT" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "0" ] && ok "فیلتر غایب: ثبت‌نشده در غایب نمی‌آید (۰)" || bad "فیلتر غایب: $RC"
# فیلتر UNSET → ۱
code admin1 "$BASE/api/attendance/report?status=UNSET" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "1" ] && ok "فیلتر ثبت‌نشده: ۱ ردیف جدا" || bad "فیلتر unset: $RC"
# فیلتر دانش‌آموز
code admin1 "$BASE/api/attendance/report?studentId=$S2ID" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "1" ] && ok "فیلتر دانش‌آموز: ۱ ردیف" || bad "فیلتر دانش‌آموز: $RC"
# فیلتر معلم ثبت‌کننده
code admin1 "$BASE/api/attendance/report?teacherId=$T3ID" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "5" ] && ok "فیلتر معلم (ثبت‌کننده t3): ۵ ردیف" || bad "فیلتر معلم: $RC"
# فیلتر تاریخ
code admin1 "$BASE/api/attendance/report?from=1404-11-21" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "0" ] && ok "فیلتر تاریخ بعد از جلسه: ۰ ردیف" || bad "فیلتر تاریخ: $RC"
code admin1 "$BASE/api/attendance/report?from=1404-11-01&to=1404-11-30" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "5" ] && ok "بازه کامل بهمن: ۵ ردیف" || bad "بازه: $RC"
# آمار
code admin1 "$BASE/api/attendance/report" > /dev/null
S7STAT=$(json "[s for s in d['stats']['perStudent'] if 'رستمی' in s['fullName']][0]")
V=$(python3 -c "
import json
d=json.load(open('$J/out.json'))
s=[x for x in d['stats']['perStudent'] if 'رستمی' in x['fullName']][0]
print(s['present'],s['absent'],s['unset'])
")
[ "$V" = "0 0 1" ] && ok "آمار s7: حاضر۰ غایب۰ ثبت‌نشده۱ (جدا از غیبت)" || bad "آمار s7: $V"
CLS=$(python3 -c "
import json
d=json.load(open('$J/out.json'))
c=[x for x in d['stats']['perClass'] if x['name']=='هفتم۱'][0]
print(c['present'],c['absent'],c['unset'],c['sessions'])
")
[ "$CLS" = "4 0 1 1" ] && ok "آمار کلاس هفتم۱: ۴/۰/۱ با ۱ جلسه نهایی (پیش‌نویس‌ها محاسبه نشدند)" || bad "آمار کلاس: $CLS"
# مدیر جلسه نهایی‌شده را اصلاح می‌کند → اعلان اصلاح برای s3
S3ID=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const u=await db.user.findUnique({where:{username:'beheshti.s3'}});console.log(u.id)")
HTTP=$(curl -s -b $J/admin1.jar -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/attendance/sessions/$ATT1 -H 'content-type: application/json' -d "{\"records\":[{\"studentId\":\"$S3ID\",\"status\":\"ABSENT\"}]}")
[ "$HTTP" = "200" ] && ok "مدیر وضعیت ثبت‌شده را اصلاح کرد (۲۰۰)" || bad "اصلاح مدیر: $HTTP"
code s2 "$BASE/api/notifications" > /dev/null
NS2=$(json "len([n for n in d['items'] if n['type']=='ATTENDANCE_CORRECTION'])")
[ "$NS2" = "0" ] && ok "s2 اعلان اصلاح ندارد (فقط s3)" || bad "s2: $NS2"
# جداسازی مدرسه در گزارش
code fadmin "$BASE/api/attendance/report" > /dev/null
RC=$(json "len(d['rows'])")
[ "$RC" = "0" ] && ok "گزارش مدیر مدرسه ۲ خالی (جداسازی کامل)" || bad "نشتی مدرسه: $RC"

say "خروجی اکسل"
HTTP=$(curl -s -b $J/admin1.jar -o $J/report.xlsx -w "%{http_code}" "$BASE/api/attendance/report/export?from=1404-11-01&to=1404-11-30")
CT=$(curl -s -b $J/admin1.jar -o /dev/null -w "%{content_type}" "$BASE/api/attendance/report/export")
SIZE=$(stat -c%s $J/report.xlsx 2>/dev/null || echo 0)
MAGIC=$(head -c 2 $J/report.xlsx)
[ "$HTTP" = "200" ] && [ "$SIZE" -gt 1000 ] && [ "$MAGIC" = "PK" ] && ok "اکسل ۲۰۰ با قالب PK ($SIZE بایت)" || bad "اکسل: $HTTP size=$SIZE"
python3 - "$J/report.xlsx" <<'PYEOF'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
wb = z.read('xl/workbook.xml').decode('utf-8')
import re
sheets = re.findall(r'name="([^"]+)"', wb)
assert any('گزارش' in s for s in sheets), sheets
assert any('دانش' in s and 'آموزان' in s for s in sheets), sheets
assert any('کلاس' in s for s in sheets), sheets
# رشته‌ها inline در شیت‌ها ذخیره می‌شوند
sheet1 = z.read('xl/worksheets/sheet1.xml').decode('utf-8')
for label in ['حاضر', 'غایب', 'ثبت‌نشده', 'آرش رستمی']:
    assert label in sheet1, f'missing {label}'
print('EXCEL-OK', sheets)
PYEOF
[ $? -eq 0 ] && ok "سه شیت فارسی + ردیف «ثبت‌نشده» جدا در اکسل" || bad "ساختار اکسل"
HTTP=$(curl -s -b $J/t1.jar -o /dev/null -w "%{http_code}" "$BASE/api/attendance/report/export")
[ "$HTTP" = "403" ] && ok "معلم ۴۰۳ روی خروجی اکسل" || bad "اکسل معلم: $HTTP"

say "گیت امکانات مدرسه (attendance=false)"
bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
const s=await db.school.findFirst({where:{name:'دبیرستان فرزانگان'}})
const f=JSON.parse(s.features||'{}'); f.attendance=false
await db.school.update({where:{id:s.id},data:{features:JSON.stringify(f)}})
console.log('disabled')
" > /dev/null 2>&1
HTTP=$(curl -s -b $J/fadmin.jar -o /dev/null -w "%{http_code}" "$BASE/api/attendance/report")
[ "$HTTP" = "403" ] && ok "با امکانات خاموش، API مدیر مدرسه ۲ → ۴۰۳" || bad "گیت امکانات: $HTTP"
HTTP=$(curl -s -b $J/ft1.jar -o /dev/null -w "%{http_code}" "$BASE/api/attendance/classes")
[ "$HTTP" = "403" ] && ok "با امکانات خاموش، API معلم مدرسه ۲ → ۴۰۳" || bad "گیت معلم: $HTTP"
bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
const s=await db.school.findFirst({where:{name:'دبیرستان فرزانگان'}})
const f=JSON.parse(s.features||'{}'); f.attendance=true
await db.school.update({where:{id:s.id},data:{features:JSON.stringify(f)}})
console.log('restored')
" > /dev/null 2>&1 && ok "امکانات مدرسه ۲ بازگردانده شد" || bad "بازگردانی"

say "لیست جلسات برای تقویم"
code t3 "$BASE/api/attendance/sessions?from=1404-11-01&to=1404-11-30" > /dev/null
NS=$(json "len(d['sessions'])")
[ "$NS" = "2" ] && ok "تقویم t3 در بهمن: ۲ جلسه (نهایی+پیش‌نویس)" || bad "لیست t3: $NS"
code t1 "$BASE/api/attendance/sessions?from=1404-11-01&to=1404-11-30" > /dev/null
NS=$(json "len(d['sessions'])")
[ "$NS" = "3" ] && ok "تقویم t1 در بهمن: ۳ جلسه (۲ هفتم۱ + ۱ هشتم۱)" || bad "لیست t1: $NS"
code s1 "$BASE/api/attendance/sessions" > /dev/null 2>&1
HTTP=$(curl -s -b $J/s1.jar -o /dev/null -w "%{http_code}" "$BASE/api/attendance/sessions")
[ "$HTTP" = "403" ] && ok "دانش‌آموز ۴۰۳ روی فهرست جلسات" || bad "لیست دانش‌آموز: $HTTP"

# ── بازگردانی داده دمو: حذف دانش‌آموز آزمون s7 (تا آمار سایر مجموعه‌تست‌ها دست‌نخورده بماند) ──
bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
await db.classroomEnrollment.deleteMany({where:{student:{username:'beheshti.s7'}}})
await db.user.deleteMany({where:{username:'beheshti.s7'}})
await db.\$disconnect()
" > /dev/null 2>&1 && ok "بازگردانی: دانش‌آموز آزمون s7 حذف شد" || bad "بازگردانی s7"

echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "نتیجه: ✅ $PASS   ❌ $FAIL"
[ $FAIL -eq 0 ] && echo "همه تست‌های حضور و غیاب پاس شد" || echo "تست‌های ناموفق وجود دارد"
exit $FAIL
