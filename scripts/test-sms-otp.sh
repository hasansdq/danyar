#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# آزمون مرحله ۷ — ورود پیامکی (OTP)، مدیریت شماره، پیکربندی سرویس
# فقط نتایج واقعی HTTP گزارش می‌شوند.
# ═══════════════════════════════════════════════════════════════
BASE="http://localhost:3000"
SMSRV="http://127.0.0.1:3056"
PASS_ADMIN="Pass@123"   # رمز مدیران مدرسه دمو
SUPER_PASS="Admin@1234"
JAR="/tmp/danyar-sms-test"
mkdir -p "$JAR"

P=0; F=0
ok()  { P=$((P+1)); echo "✔ [OK] $1"; }
bad() { F=$((F+1)); echo "✘ [FAIL] $1"; }
check() { # check "title" "expr"
  if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi
}

# شماره‌های آزمون (فیک نیستند — به گیرنده آزمون محلی می‌روند)
XF_IP="10.77.$((RANDOM%250)).$((RANDOM%250))"
PHONE_S1="09120000001"
PHONE_S2="09120000002"        # beheshti.s2
PHONE_UNKNOWN="09350000099"

echo "── آماده‌سازی ──"
# پاک‌سازی گیرنده آزمون + کدهای یک‌بارمصرف قبلی (سقف ساعتانه در دیتابیس می‌ماند)
curl -s -X POST "$SMSRV/reset" > /dev/null
bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();await db.otpCode.deleteMany();await db.smsConfig.updateMany({data:{enabled:false,provider:''}});await db.\$disconnect();console.log('otp-cleaned')" > /dev/null 2>&1
sleep 6  # فاصله امن از اجرای قبلی (فاصله ارسال مجدد درون‌حافظه)
rm -f "$JAR"/*.txt

# ورود مدیر کل (از /superadmin با realm)
SUPER_LOGIN=$(curl -s -c "$JAR/super.txt" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"superadmin\",\"password\":\"$SUPER_PASS\",\"realm\":\"superadmin\"}")
check "ورود مدیر کل از مسیر realm=superadmin" "$(echo "$SUPER_LOGIN" | jq -r 'if .redirect=="/admin" then 1 else 0 end')"

# ورود مدیر مدرسه ۱
ADMIN_LOGIN=$(curl -s -c "$JAR/admin1.txt" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"beheshti.admin\",\"password\":\"$PASS_ADMIN\",\"realm\":\"app\"}")
check "ورود مدیر مدرسه ۱" "$(echo "$ADMIN_LOGIN" | jq -r 'if .redirect=="/chats" then 1 else 0 end')"

# ورود مدیر مدرسه ۲
curl -s -c "$JAR/admin2.txt" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"farzanegan.admin\",\"password\":\"$PASS_ADMIN\",\"realm\":\"app\"}" > /dev/null

# شناسه‌های کاربران
S1_ID=$(curl -s -b "$JAR/admin1.txt" "$BASE/api/users?q=beheshti.s1" | jq -r '.users[0].id')
S2_ID=$(curl -s -b "$JAR/admin1.txt" "$BASE/api/users?q=beheshti.s2" | jq -r '.users[0].id')
F_S1_ID=$(curl -s -b "$JAR/admin2.txt" "$BASE/api/users?q=farzanegan.s1" | jq -r '.users[0].id')
check "یافتن شناسه دانش‌آموزان" "$(if [ -n "$S1_ID" ] && [ "$S1_ID" != "null" ] && [ -n "$F_S1_ID" ] && [ "$F_S1_ID" != "null" ]; then echo 1; else echo 0; fi)"

echo "── ۱. پیکربندی سرویس پیامک (مدیر کل) ──"
# پیش از فعال‌سازی: درخواست OTP باید 503 واقعی بدهد
BEFORE=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}" -o /tmp/otp-before.json -w "%{http_code}")
check "درخواست OTP قبل از فعال‌سازی → 503 واقعی" "$(if [ "$BEFORE" = "503" ]; then echo 1; else echo 0; fi)"

# پیکربندی ارائه‌دهنده «REST سازگار» به گیرنده آزمون محلی
CFG=$(curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" \
  -H 'Content-Type: application/json' \
  -d '{
    "config": {
      "provider": "otpy",
      "enabled": true,
      "smsLoginEnabled": true,
      "passwordLoginEnabled": true,
      "codeTtlSeconds": 120,
      "resendCooldownSeconds": 5,
      "maxAttemptsPerCode": 5,
      "maxRequestsPerHour": 5,
      "credentials": {
        "endpoint": "http://127.0.0.1:3056/send",
        "headerName": "X-Test-Auth",
        "headerValue": "test-secret-value-12345",
        "bodyTemplate": "{\"phone\":\"{{phone}}\",\"code\":\"{{code}}\"}"
      }
    }
  }')
check "ذخیره پیکربندی سرویس پیامک" "$(echo "$CFG" | jq -r 'if .config.provider=="otpy" and .config.enabled==true then 1 else 0 end')"

# ماسک کلیدها در پاسخ پیکربندی
MASKED=$(curl -s -b "$JAR/super.txt" "$BASE/api/admin/sms/config")
check "کلید محرمانه در پاسخ ماسک شده است" "$(echo "$MASKED" | jq -r 'if .config.credentials.headerValue == "••••2345" then 1 else 0 end')"
check "مقدار واقعی کلید در پاسخ نیست" "$(if echo "$MASKED" | rg -q "test-secret-value"; then echo 0; else echo 1; fi)"

echo "── ۲. ارسال آزمایشی واقعی ──"
TEST_SEND=$(curl -s -b "$JAR/super.txt" -X POST "$BASE/api/admin/sms/test" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"۰۹۱۲۳۴۵۶۷۸۹\"}")
check "ارسال آزمایشی به شماره با ارقام فارسی موفق" "$(echo "$TEST_SEND" | jq -r 'if .ok==true then 1 else 0 end')"
check "گزارش آزمایش شماره کامل ندارد (ماسک)" "$(echo "$TEST_SEND" | jq -r 'if .maskedPhone=="0912***6789" then 1 else 0 end')"
check "کد ارسال‌شده در گزارش آزمایش نیست" "$(if echo "$TEST_SEND" | rg -q '"code"'; then echo 0; else echo 1; fi)"

# ارسال آزمایشی بدون سرویس انتخاب‌شده → خطای واقعی
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"provider":""}}' > /dev/null
NO_PROVIDER=$(curl -s -b "$JAR/super.txt" -X POST "$BASE/api/admin/sms/test" -H 'Content-Type: application/json' -d '{"phone":"09123456789"}' -o /tmp/np.json -w "%{http_code}")
check "ارسال آزمایشی بدون سرویس → خطای واقعی" "$(if [ "$NO_PROVIDER" = "400" ]; then echo 1; else echo 0; fi)"
# بازگرداندن سرویس
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"provider":"otpy"}}' > /dev/null

echo "── ۳. مدیریت شماره تلفن (مدیر مدرسه) ──"
# تنظیم شماره با ارقام فارسی + تأیید رمز مدیر
SET1=$(curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S1_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"۰۹۱۲۰۰۰۰۰۰۱\",\"adminPassword\":\"$PASS_ADMIN\"}")
check "تنظیم شماره با ارقام فارسی و تأیید رمز" "$(echo "$SET1" | jq -r 'if .user.phone=="09120000001" then 1 else 0 end')"

# بدون رمز مدیر → رد
NO_PASS=$(curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" \
  -H 'Content-Type: application/json' -d '{"phone":"09120000002"}' -o /tmp/np2.json -w "%{http_code}")
check "تغییر شماره بدون رمز مدیر → 403" "$(if [ "$NO_PASS" = "403" ]; then echo 1; else echo 0; fi)"

# رمز نادرست → رد
WRONG_PASS=$(curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"09120000002\",\"adminPassword\":\"wrong-pass\"}" -o /tmp/wp.json -w "%{http_code}")
check "تغییر شماره با رمز نادرست → 403" "$(if [ "$WRONG_PASS" = "403" ]; then echo 1; else echo 0; fi)"

# تنظیم شماره s2 با قالب +98
SET2=$(curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"+98 912-000-00-02\",\"adminPassword\":\"$PASS_ADMIN\"}")
check "نرمال‌سازی قالب +98 و خط تیره" "$(echo "$SET2" | jq -r 'if .user.phone=="09120000002" then 1 else 0 end')"

# یکتایی سراسری: همان شماره در مدرسه دیگر
DUP=$(curl -s -b "$JAR/admin2.txt" -X PATCH "$BASE/api/users/$F_S1_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"09120000001\",\"adminPassword\":\"$PASS_ADMIN\"}" -o /tmp/dup.json -w "%{http_code}")
check "شماره تکراری سراسری → 409" "$(if [ "$DUP" = "409" ]; then echo 1; else echo 0; fi)"

# جداسازی مدرسه: مدیر ۲ نمی‌تواند شماره کاربر مدرسه ۱ را تغییر دهد
CROSS=$(curl -s -b "$JAR/admin2.txt" -X PATCH "$BASE/api/users/$S2_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"09330000001\",\"adminPassword\":\"$PASS_ADMIN\"}" -o /tmp/cross.json -w "%{http_code}")
check "مدیر مدرسه دیگر → 404" "$(if [ "$CROSS" = "404" ]; then echo 1; else echo 0; fi)"

# شماره نامعتبر
INVALID=$(curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"12345\",\"adminPassword\":\"$PASS_ADMIN\"}" -o /tmp/inv.json -w "%{http_code}")
check "شماره نامعتبر → 400" "$(if [ "$INVALID" = "400" ]; then echo 1; else echo 0; fi)"

echo "── ۴. درخواست کد OTP ──"
# پاسخ عمومی برای شماره بدون حساب
R_UNKNOWN=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_UNKNOWN\"}")
R_KNOWN=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}")
check "درخواست کد برای شماره ثبت‌شده → ok" "$(echo "$R_KNOWN" | jq -r 'if .ok==true then 1 else 0 end')"
# عدم افشای وجود حساب: ساختار پاسخ یکسان
UK_KEYS=$(echo "$R_UNKNOWN" | jq -r 'keys | sort | join(",")')
KN_KEYS=$(echo "$R_KNOWN" | jq -r 'keys | sort | join(",")')
check "پاسخ عمومی — ساختار یکسان برای شماره با/بدون حساب" "$(if [ "$UK_KEYS" = "$KN_KEYS" ]; then echo 1; else echo 0; fi)"

# کد واقعاً به گیرنده آزمون رسیده؟
MSG=$(curl -s "$SMSRV/messages")
CNT=$(echo "$MSG" | jq '.count')
check "پیامک واقعاً به سرویس آزمون رسیده است" "$(if [ "$CNT" -ge 2 ]; then echo 1; else echo 0; fi)"
CODE=$(echo "$MSG" | jq -r --arg p "$PHONE_S1" '[.messages[] | select(.phone==$p)][-1].code')
check "کد ۶ رقمی دریافت شد" "$(if echo "$CODE" | rg -q '^[0-9]{6}$'; then echo 1; else echo 0; fi)"

# شماره بدون حساب: هیچ پیامکی نفرستاده شده
UNK_SENT=$(echo "$MSG" | jq --arg p "$PHONE_UNKNOWN" '[.messages[] | select(.phone==$p)] | length')
check "برای شماره بدون حساب پیامکی ارسال نشده" "$(if [ "$UNK_SENT" = "0" ]; then echo 1; else echo 0; fi)"

# فاصله ارسال مجدد
COOL=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}" -o /tmp/cool.json -w "%{http_code}")
check "درخواست فوری دوم → 429 با retryAfter" "$(if [ "$COOL" = "429" ] && [ "$(cat /tmp/cool.json | jq '.retryAfter')" -gt 0 ]; then echo 1; else echo 0; fi)"

sleep 6  # عبور از فاصله ۵ ثانیه‌ای

echo "── ۵. بررسی کد و ورود ──"
# کد نادرست
WRONG=$(curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\",\"code\":\"000000\"}" -o /tmp/w.json -w "%{http_code}")
check "کد نادرست → 400" "$(if [ "$WRONG" = "400" ]; then echo 1; else echo 0; fi)"

# کد درست → ورود
VERIFY=$(curl -s -c "$JAR/otp-session.txt" -X POST "$BASE/api/auth/otp/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"۰۹۱۲۰۰۰۰۰۰۱\",\"code\":\"$CODE\"}")
check "ورود موفق با کد درست (ارقام فارسی هم پذیرفته می‌شود)" "$(echo "$VERIFY" | jq -r 'if .ok==true and .redirect=="/chats" and .user.username=="beheshti.s1" then 1 else 0 end')"
ME=$(curl -s -b "$JAR/otp-session.txt" "$BASE/api/me")
check "نشست OTP واقعاً معتبر است" "$(echo "$ME" | jq -r 'if .user.username=="beheshti.s1" then 1 else 0 end')"

# مصرف دوباره همان کد
REUSE=$(curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\",\"code\":\"$CODE\"}" -o /tmp/reuse.json -w "%{http_code}")
check "استفاده مجدد از کد مصرف‌شده → 400" "$(if [ "$REUSE" = "400" ]; then echo 1; else echo 0; fi)"

echo "── ۶. سقف تلاش برای هر کد ──"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"maxAttemptsPerCode":2}}' > /dev/null
sleep 6
curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}" > /dev/null
sleep 6
CODE2=$(curl -s "$SMSRV/messages" | jq -r --arg p "$PHONE_S1" '[.messages[] | select(.phone==$p)][-1].code')
curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\",\"code\":\"111111\"}" > /dev/null
curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\",\"code\":\"222222\"}" > /dev/null
LOCKED=$(curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\",\"code\":\"$CODE2\"}" -o /tmp/lock.json -w "%{http_code}")
check "پس از سقف تلاش، حتی کد درست رد می‌شود" "$(if [ "$LOCKED" = "400" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"maxAttemptsPerCode":5}}' > /dev/null

echo "── ۷. سقف درخواست ساعتانه ──"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"maxRequestsPerHour":2,"resendCooldownSeconds":5}}' > /dev/null
# تا این لحظه ۲ کد برای این شماره در این ساعت ساخته شده → درخواست سوم باید 429 باشد
sleep 6
RATE=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}" -o /tmp/rate.json -w "%{http_code}")
check "سقف درخواست ساعتانه → 429 سمت سرور" "$(if [ "$RATE" = "429" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"maxRequestsPerHour":5}}' > /dev/null

echo "── ۸. حساب غیرفعال و مدیر کل ──"
# غیرفعال کردن s2 و بررسی عدم ارسال پیامک
curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" -H 'Content-Type: application/json' -d '{"isActive":false}' > /dev/null
BEFORE_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
INACT=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S2\"}")
AFTER_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
check "حساب غیرفعال: پاسخ عمومی بدون ارسال پیامک" "$(if [ "$(echo "$INACT" | jq '.ok')" = "true" ] && [ "$AFTER_CNT" = "$BEFORE_CNT" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/admin1.txt" -X PATCH "$BASE/api/users/$S2_ID" -H 'Content-Type: application/json' -d '{"isActive":true}' > /dev/null

# شماره متعلق به مدیر کل → بدون ارسال و بدون ورود
curl -s -b "$JAR/super.txt" "$BASE/api/admin/users" > /dev/null 2>&1
SUPER_PHONE_SET=$(cd /home/z/my-project && bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.user.update({ where: { username: 'superadmin' }, data: { phone: '09990000001' } })
console.log('ok')
await db.\$disconnect()
")
BEFORE_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
SUPER_REQ=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d '{"phone":"09990000001"}')
AFTER_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
check "مدیر کل: درخواست کد پاسخ عمومی و بدون ارسال" "$(if [ "$(echo "$SUPER_REQ" | jq '.ok')" = "true" ] && [ "$AFTER_CNT" = "$BEFORE_CNT" ]; then echo 1; else echo 0; fi)"
SUPER_VERIFY=$(curl -s -X POST "$BASE/api/auth/otp/verify" -H 'Content-Type: application/json' -d '{"phone":"09990000001","code":"123456"}' -o /tmp/sv.json -w "%{http_code}")
check "ورود پیامکی مدیر کل ممکن نیست" "$(if [ "$SUPER_VERIFY" != "200" ]; then echo 1; else echo 0; fi)"

# مدرسه غیرفعال: پیامک ارسال نمی‌شود
SCHOOL2_ID=$(cd /home/z/my-project && bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const s = await db.user.findUnique({ where: { username: 'farzanegan.s1' } })
console.log(s.schoolId)
await db.\$disconnect()
")
F_S1_PHONE_SET=$(curl -s -b "$JAR/admin2.txt" -X PATCH "$BASE/api/users/$F_S1_ID" -H 'Content-Type: application/json' -d "{\"phone\":\"09120000009\",\"adminPassword\":\"$PASS_ADMIN\"}" > /dev/null; echo done)
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/schools/$SCHOOL2_ID" -H 'Content-Type: application/json' -d '{"isActive":false}' > /dev/null 2>&1 || true
# اگر API مدرسه ساختار متفاوتی دارد، مستقیم در دیتابیس
SCH_OFF=$(cd /home/z/my-project && bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.school.update({ where: { id: '$SCHOOL2_ID' }, data: { isActive: false } })
console.log('ok')
await db.\$disconnect()
")
BEFORE_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
INACTIVE_SCH=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d '{"phone":"09120000009"}')
AFTER_CNT=$(curl -s "$SMSRV/messages" | jq '.count')
check "مدرسه غیرفعال: بدون ارسال پیامک" "$(if [ "$AFTER_CNT" = "$BEFORE_CNT" ]; then echo 1; else echo 0; fi)"
cd /home/z/my-project && bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.school.update({ where: { id: '$SCHOOL2_ID' }, data: { isActive: true } })
await db.\$disconnect()
" > /dev/null

echo "── ۹. گیت ورود با رمز ──"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"passwordLoginEnabled":false}}' > /dev/null
PW_OFF=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"beheshti.admin\",\"password\":\"$PASS_ADMIN\",\"realm\":\"app\"}" -o /tmp/pw.json -w "%{http_code}")
check "غیرفعال‌شدن ورود با رمز → 403 سمت سرور" "$(if [ "$PW_OFF" = "403" ]; then echo 1; else echo 0; fi)"
SUPER_STILL=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"superadmin\",\"password\":\"$SUPER_PASS\",\"realm\":\"superadmin\"}" -o /tmp/sp.json -w "%{http_code}")
check "ورود مدیر کل همیشه با رمز ممکن است" "$(if [ "$SUPER_STILL" = "200" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"passwordLoginEnabled":true}}' > /dev/null

echo "── ۱۰. خاموش‌کردن ورود پیامکی ──"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"smsLoginEnabled":false}}' > /dev/null
SMS_OFF=$(curl -s -X POST "$BASE/api/auth/otp/request" -H "x-forwarded-for: $XF_IP" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_S1\"}" -o /tmp/smsoff.json -w "%{http_code}")
check "ورود پیامکی خاموش → 503 واقعی" "$(if [ "$SMS_OFF" = "503" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/super.txt" -X PUT "$BASE/api/admin/sms/config" -H 'Content-Type: application/json' \
  -d '{"config":{"smsLoginEnabled":true}}' > /dev/null

echo "── ۱۱. گزارش ارسال‌ها (بدون شماره کامل / کد / کلید) ──"
LOGS=$(curl -s -b "$JAR/super.txt" "$BASE/api/admin/sms/logs")
FULL_PHONE_LEAK=$(echo "$LOGS" | rg -c '09120000001|09123456789' || true)
CODE_LEAK=$(echo "$LOGS" | rg -c "\"code\"" || true)
KEY_LEAK=$(echo "$LOGS" | rg -c 'test-secret-value' || true)
check "گزارش‌ها شماره کامل ندارند" "$(if [ "${FULL_PHONE_LEAK:-0}" = "0" ]; then echo 1; else echo 0; fi)"
check "گزارش‌ها کد ورود ندارند" "$(if [ "${CODE_LEAK:-0}" = "0" ]; then echo 1; else echo 0; fi)"
check "گزارش‌ها کلید محرمانه ندارند" "$(if [ "${KEY_LEAK:-0}" = "0" ]; then echo 1; else echo 0; fi)"
check "گزارش‌ها شماره ماسک‌شده دارند" "$(echo "$LOGS" | jq -r 'if ([.logs[].maskedPhone] | length) > 0 and ([.logs[].maskedPhone | test("^09[0-9]{2}\\*\\*\\*[0-9]{4}$")] | all) then 1 else 0 end')"

echo "── ۱۲. محدودیت IP و ناحیه دسترسی ──"
ADMIN_TEST=$(curl -s -b "$JAR/admin1.txt" "$BASE/api/admin/sms/config" -o /tmp/an.json -w "%{http_code}")
check "API پیکربندی پیامک فقط مدیر کل → 403 برای مدیر مدرسه" "$(if [ "$ADMIN_TEST" = "403" ]; then echo 1; else echo 0; fi)"

# پاک‌سازی شماره superadmin
cd /home/z/my-project && bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.user.update({ where: { username: 'superadmin' }, data: { phone: null } })
await db.\$disconnect()
" > /dev/null

echo ""
echo "═══════════════════════════════════"
echo "نتیجه: $P موفق، $F ناموفق"
[ "$F" = "0" ] && echo "همه آزمون‌ها پاس شد ✔" || echo "برخی آزمون‌ها شکست خورد ✘"
exit $F
