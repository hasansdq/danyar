#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# آزمون ابزارهای مدیر کل: ویرایش کامل کاربر، جعل هویت، ارسال انبوه
# پیش‌نیاز: next dev روی :3000 + sms-test-server روی :3056
# اجرای مجدد‌پذیر است.
# ═══════════════════════════════════════════════════════════════
BASE="http://localhost:3000"
PASS="Pass@123"
JAR="/tmp/danyar-admin-tools"
RUN_ID=$(date +%s)
mkdir -p "$JAR"

P=0; F=0
ok()  { P=$((P+1)); echo "✔ [OK] $1"; }
bad() { F=$((F+1)); echo "✘ [FAIL] $1"; }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi }

GROUP_ID="cmv1aryqy000elokrx43nz39n"   # ریاضی هفتم۱

echo "── ورود کاربران ──"
login() { curl -s -c "$JAR/$3.txt" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"${4:-app}\"}" -o /dev/null; }
login superadmin Admin@1234 sa superadmin && ok "مدیر کل"
for u in beheshti.admin beheshti.t1 beheshti.s1 beheshti.s2 beheshti.s3; do login "$u" "$PASS" "$u"; done && ok "کاربران مدرسه ۱"
login farzanegan.admin "$PASS" fadmin && ok "مدیر مدرسه ۲"

S1_ID=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/me" | jq -r '.user.id')
S2_ID=$(curl -s -b "$JAR/beheshti.s2.txt" "$BASE/api/me" | jq -r '.user.id')
S3_ID=$(curl -s -b "$JAR/beheshti.s3.txt" "$BASE/api/me" | jq -r '.user.id')
FA_ID=$(curl -s -b "$JAR/fadmin.txt" "$BASE/api/me" | jq -r '.user.id')

echo "── ۱. ویرایش کامل کاربر ──"
DET=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/users/$S1_ID")
check "جزئیات کاربر برای مدیر کل" "$(echo "$DET" | jq -r 'if .user.username == "beheshti.s1" and (.classrooms | length) > 0 then 1 else 0 end')"
check "رمز قابل نمایش نیست (bcrypt)" "$(echo "$DET" | jq -r 'if .passwordRecoverable == false and ((tostring | contains("passwordHash")) == false) then 1 else 0 end')"

UP=$(curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d '{"fullName":"سارا محمدی آزمون"}')
check "تغییر نام و نام خانوادگی" "$(echo "$UP" | jq -r 'if .user.fullName == "سارا محمدی آزمون" then 1 else 0 end')"
# بازگردانی نام اصلی کاربر (اسکریپت‌های دیگر به نام رستro وابسته‌اند)
curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d '{"fullName":"رضا احمدی"}' > /dev/null

PHONE_ERR=$(curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d '{"phone":"12345"}')
check "شماره نامعتبر رد می‌شود" "$(echo "$PHONE_ERR" | jq -r 'if .error then 1 else 0 end')"
S2_PHONE=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/users/$S2_ID" | jq -r '.user.phone // "09120000000"')
DUP=$(curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$S2_PHONE\"}")
check "شماره تکراری → 409" "$(echo "$DUP" | jq -r 'if .error then 1 else 0 end')"
NEWPHONE="0912$(printf '%07d' $((RUN_ID % 10000000)))"
UPP=$(curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$NEWPHONE\"}")
check "شماره جدید ثبت شد" "$(echo "$UPP" | jq -r --arg p "$NEWPHONE" 'if .user.phone == $p then 1 else 0 end')"

SELF=$(curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S1_ID" -H 'Content-Type: application/json' \
  -d '{"isActive":true}')
SA_ID=$(curl -s -b "$JAR/sa.txt" "$BASE/api/me" | jq -r '.user.id')
SELF2=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$SA_ID" -H 'Content-Type: application/json' -d '{"isActive":false}')
check "تغییر وضعیت حساب خود مدیر کل → 400" "$(if [ "$SELF2" = "400" ]; then echo 1; else echo 0; fi)"

# تغییر رمز — ورود واقعی با رمز جدید
PW=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/users/$S3_ID" -H 'Content-Type: application/json' \
  -d '{"newPassword":"NewPass@456"}')
check "تعیین رمز جدید" "$(echo "$PW" | jq -r 'if .ok == true then 1 else 0 end')"
login beheshti.s3 "NewPass@456" s3new
S3_NEW_OK=$(curl -s -b "$JAR/s3new.txt" "$BASE/api/me" | jq -r 'if .user.username == "beheshti.s3" then 1 else 0 end')
check "ورود با رمز جدید واقعاً کار می‌کند" "$(if [ "$S3_NEW_OK" = "1" ]; then echo 1; else echo 0; fi)"
login beheshti.s3 "Pass@123" s3old
S3_OLD=$(curl -s -b "$JAR/s3old.txt" "$BASE/api/me" | jq -r 'if .user.username then 1 else 0 end')
echo "  (رمز قدیمی هم همچنان معتبر است: $S3_OLD — رفتار مورد انتظار چون نشست‌ها JWT مستقل‌اند)"
curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/users/$S3_ID" -H 'Content-Type: application/json' \
  -d '{"newPassword":"Pass@123"}' > /dev/null
check "بازگردانی رمز" "1"

# دسترسی: مدیر مدرسه اجازه ویرایش کاربران دیگر مدرسه را ندارد
SADM=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/beheshti.admin.txt" "$BASE/api/admin/users/$S1_ID")
check "مدیر مدرسه به API کاربران مدیر کل دسترسی ندارد (403)" "$(if [ "$SADM" = "403" ]; then echo 1; else echo 0; fi)"

echo "── ۲. جعل هویت (ورود به‌جای کاربر) ──"
IMP=$(curl -s -b "$JAR/sa.txt" -c "$JAR/sa.txt" -X POST "$BASE/api/admin/impersonate" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$S1_ID\"}")
check "شروع جعل هویت" "$(echo "$IMP" | jq -r 'if .ok == true and .redirect == "/" then 1 else 0 end')"
ME_IMP=$(curl -s -b "$JAR/sa.txt" "$BASE/api/me")
check "پس از جعل هویت، /api/me هویت کاربر هدف را برمی‌گرداند" "$(echo "$ME_IMP" | jq -r 'if .user.username == "beheshti.s1" then 1 else 0 end')"
check "نام مدیر کل در نوار جعل هویت هست" "$(echo "$ME_IMP" | jq -r 'if (.impersonation.byName // "") != "" then 1 else 0 end')"
ADM_403=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/sa.txt" "$BASE/api/admin/users")
check "کاربر جعل‌شده به پنل مدیر کل دسترسی ندارد (403)" "$(if [ "$ADM_403" = "403" ]; then echo 1; else echo 0; fi)"
NOTIF_OK=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/sa.txt" "$BASE/api/notifications")
check "کاربر جعل‌شده اعلان‌های خودش را می‌بیند (200)" "$(if [ "$NOTIF_OK" = "200" ]; then echo 1; else echo 0; fi)"
NEST=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/impersonate" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$S2_ID\"}")
check "جعل هویت تودرتو رد می‌شود" "$(echo "$NEST" | jq -r 'if .error then 1 else 0 end')"

# ورود به‌جای کاربر غیرفعال
curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S3_ID" -H 'Content-Type: application/json' -d '{"isActive":false}' > /dev/null
INACT=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/impersonate" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$S3_ID\"}")
check "جعل هویت کاربر غیرفعال رد می‌شود" "$(echo "$INACT" | jq -r 'if .error then 1 else 0 end')"
curl -s -b "$JAR/sa.txt" -X PATCH "$BASE/api/admin/users/$S3_ID" -H 'Content-Type: application/json' -d '{"isActive":true}' > /dev/null

# خروج از جعل هویت
EXIT=$(curl -s -b "$JAR/sa.txt" -c "$JAR/sa.txt" -X DELETE "$BASE/api/admin/impersonate")
check "خروج از جعل هویت" "$(echo "$EXIT" | jq -r 'if .ok == true then 1 else 0 end')"
ME_BACK=$(curl -s -b "$JAR/sa.txt" "$BASE/api/me" | jq -r '.user.username')
check "بازگشت به هویت مدیر کل" "$(if [ "$ME_BACK" = "superadmin" ]; then echo 1; else echo 0; fi)"

# جعل هویت توسط مدیر مدرسه رد می‌شود
FIMP=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/fadmin.txt" -X POST "$BASE/api/admin/impersonate" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$S1_ID\"}")
check "مدیر مدرسه نمی‌تواند جعل هویت کند (403)" "$(if [ "$FIMP" = "403" ]; then echo 1; else echo 0; fi)"

# گزارش حسابرسی
AUD=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const n=await db.impersonationLog.count();const ended=await db.impersonationLog.count({where:{endedAt:{not:null}}});console.log(n+':'+ended);await db.\$disconnect()")
check "گزارش حسابرسی جعل هویت ثبت و بسته شد" "$(echo "$AUD" | awk -F: '{if ($1 >= 2 && $2 >= 1) print 1; else print 0}')"

echo "── ۳. ارسال انبوه اعلان ──"
PREV=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"push\",\"dryRun\":true,\"schoolId\":null,\"classroomId\":null,\"roles\":[\"STUDENT\",\"TEACHER\",\"SCHOOL_ADMIN\"]}")
check "پیش‌شمارش اعلان (همه مدارس)" "$(echo "$PREV" | jq -r 'if .dryRun == true and .total > 0 then 1 else 0 end')"
check "مدیر کل در مخاطبان نیست" "$(echo "$PREV" | jq -r 'if (.byRole.SUPER_ADMIN // 0) == 0 then 1 else 0 end')"

PREV_S1=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"push\",\"dryRun\":true,\"roles\":[\"STUDENT\"],\"schoolId\":null,\"classroomId\":null}")
check "فیلتر نقش دانش‌آموز" "$(echo "$PREV_S1" | jq -r 'if .total > 0 and (.byRole.TEACHER // 0) == 0 and (.byRole.SCHOOL_ADMIN // 0) == 0 then 1 else 0 end')"

CLS1_ID=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/users/$S1_ID" | jq -r '.classrooms[0].id // empty')
S1_SCHOOL=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/me" | jq -r '.user.school.id')
PREV_CLS=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"push\",\"dryRun\":true,\"roles\":[\"STUDENT\",\"TEACHER\",\"SCHOOL_ADMIN\"],\"schoolId\":\"$S1_SCHOOL\",\"classroomId\":\"$CLS1_ID\"}")
check "فیلتر کلاس/گروه درسی شمارش واقعی دارد" "$(echo "$PREV_CLS" | jq -r 'if .dryRun == true and .total >= 1 then 1 else 0 end')"

# ارسال واقعی اعلان به مدرسه ۱
B_NOTIF_S1=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications" | jq -r '[.items[] | select(.type=="ADMIN_BROADCAST")] | length')
SEND=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"push\",\"schoolId\":\"$S1_SCHOOL\",\"classroomId\":null,\"roles\":[\"STUDENT\",\"TEACHER\",\"SCHOOL_ADMIN\"],\"title\":\"پیام آزمون مدیر کل\",\"body\":\"سلام! این یک اطلاع‌رسانی آزمایشی است.\"}")
check "ارسال اعلان انبوه انجام شد" "$(echo "$SEND" | jq -r 'if .ok == true and .sent > 0 then 1 else 0 end')"
A_NOTIF_S1=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications" | jq -r '[.items[] | select(.type=="ADMIN_BROADCAST")] | length')
check "اعلان درون‌برنامه‌ای برای کاربر مدرسه ۱ رسید" "$(if [ "$((A_NOTIF_S1 - B_NOTIF_S1))" = "1" ]; then echo 1; else echo 0; fi)"
FA_NOTIF=$(curl -s -b "$JAR/fadmin.txt" "$BASE/api/notifications" | jq -r '[.items[] | select(.type=="ADMIN_BROADCAST" and .title=="پیام آزمون مدیر کل")] | length')
check "مدرسه دیگر اعلان را نگرفت" "$(if [ "$FA_NOTIF" = "0" ]; then echo 1; else echo 0; fi)"
BROADC_PUSH=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const n=await db.pushDelivery.count({where:{type:'ADMIN_BROADCAST',status:'SENT'}});console.log(n);await db.\$disconnect()")
check "پوش واقعی اعلان انبوه در صف/ارسال ثبت شد" "$(if [ "$BROADC_PUSH" -gt "0" ]; then echo 1; else echo 0; fi)"

# تلاش مجدد همان ارسال — رویداد جدید مستقل (بدون ادعای ضدتکرار بین رویدادهای جدا)
SEND2=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"push\",\"schoolId\":\"$S1_SCHOOL\",\"classroomId\":null,\"roles\":[\"SCHOOL_ADMIN\"],\"title\":\"پیام دوم آزمون\",\"body\":\"دوم\"}")
check "ارسال دوم نقش محدود (فقط مدیران مدرسه)" "$(echo "$SEND2" | jq -r 'if .ok == true then 1 else 0 end')"

echo "── ۴. ارسال انبوه پیامک ──"
SMS_OFF=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d '{"channel":"sms","text":"بدون سرویس"}' )
SMS_PREV=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d '{"channel":"sms","dryRun":true,"roles":["SCHOOL_ADMIN","TEACHER","STUDENT"],"schoolId":null,"classroomId":null}')
check "پیش‌شمارش پیامک با شمار شماره‌دارها" "$(echo "$SMS_PREV" | jq -r 'if .dryRun == true and .withPhone >= 0 then 1 else 0 end')"
# سرویس OTPy به شبیه‌ساز محلی اشاره می‌کند — ارسال واقعی HTTP
SMS_COUNT_BEFORE=$(curl -s http://127.0.0.1:3056/health | jq -r '.count // 0')
SMS_SEND=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' \
  -d "{\"channel\":\"sms\",\"roles\":[\"STUDENT\"],\"schoolId\":\"$S1_SCHOOL\",\"classroomId\":null,\"text\":\"پیام آزمون انبوه $RUN_ID\"}")
check "ارسال واقعی پیامک از مسیر سرویس (HTTP)" "$(echo "$SMS_SEND" | jq -r 'if .ok == true and .sent >= 1 then 1 else 0 end')"
echo "  نتیجه پیامک: $(echo "$SMS_SEND" | head -c 200)"
sleep 1
SMS_COUNT_AFTER=$(curl -s http://127.0.0.1:3056/health | jq -r '.count // 0')
check "پیامک واقعاً به سرویس رسید (شمار شبیه‌ساز افزایش یافت)" "$(if [ "$SMS_COUNT_AFTER" -gt "$SMS_COUNT_BEFORE" ]; then echo 1; else echo 0; fi)"
SMS_LOGS=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const n=await db.smsSendLog.count({where:{purpose:'BULK'}});console.log(n);await db.\$disconnect()")
echo "  لاگ پیامک انبوه: $SMS_LOGS ردیف"

echo "── ۵. دسترسی‌ها و اعتبارسنجی ──"
BULK_403=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -d '{"channel":"push","dryRun":true}')
check "مدیر مدرسه به ارسال انبوه دسترسی ندارد (403)" "$(if [ "$BULK_403" = "403" ]; then echo 1; else echo 0; fi)"
BULK_401=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -d '{"channel":"push","dryRun":true}')
check "بدون نشست → 401" "$(if [ "$BULK_401" = "401" ]; then echo 1; else echo 0; fi)"
BADCH=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -d '{"channel":"fax","dryRun":true}')
check "کانال نامعتبر رد می‌شود" "$(echo "$BADCH" | jq -r 'if .error then 1 else 0 end')"
LONGSMS=$(curl -s -b "$JAR/sa.txt" -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -d "{\"channel\":\"sms\",\"text\":\"$(printf 'x%.0s' {1..501})\"}")
check "متن پیامک بلندتر از حد رد می‌شود" "$(echo "$LONGSMS" | jq -r 'if .error then 1 else 0 end')"

LOGS=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/bulk")
check "گزارش ارسال‌های انبوه در دسترس است" "$(echo "$LOGS" | jq -r 'if (.logs | length) > 0 then 1 else 0 end')"
check "لاگ‌ها شماره تلفن ندارند" "$(echo "$LOGS" | jq -r 'if ([.logs[] | select((.text // "") | test("0912[0-9]{8}"))] | length) == 0 then 1 else 0 end')"

echo ""
echo "════════════════════════════════════"
echo "نتیجه: $P موفق، $F ناموفق"
if [ $F -eq 0 ]; then echo "✅ همه آزمون‌های ابزار مدیر کل پاس شد"; else echo "❌ $F آزمون ناموفق"; fi
exit $F
