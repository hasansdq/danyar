#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست مدیریت کاربران (درخواست کاربر — مرحله جدید):
#  ۱) افزودن تکی: نام/نام خانوادگی/نقش/کدملی/شماره/کلاس (+مدرسه برای مدیر کل)
#     نام کاربری = کدملی؛ رمز پیش‌فرض = 123456
#  ۲) افزودن گروهی دانش‌آموزان (لیست + ثبت کل لیست)
#  ۳) ایمپورت اکسل (فرمت جدید + کلاس الزامی + نقش فارسی/خالی)
#  ۴) رمز ضعیف مجاز (فقط عدد/فقط حرف) با حداقل ۶ کاراکتر
#  ۵) ویرایش نام/نام خانوادگی؛ حساب مدیر مدرسه با کدملی
# اجرای مجدد‌پذیر: پاک‌سازی ابتدای اسکریپت
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
PASS=0; FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name (got $actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — انتظار $expected، دریافت $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "── ورود کاربران تستی ──"
S=$(curl -s -c /tmp/cum_super.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"superadmin","password":"Admin@1234","realm":"superadmin"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر کل" 200 "$S"
A=$(curl -s -c /tmp/cum_a1.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.admin","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر مدرسه ۱" 200 "$A"
T=$(curl -s -c /tmp/cum_t1.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.t1","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود معلم" 200 "$T"

# پاک‌سازی اجراهای قبلی — همه کدملی‌های این اسکریپت با پیشوند 1410
NIDS="1410000001 1410000002 1410000003 1410000004 1410000005 1410000006 1410000007 1410000008 1410000009 1410000010 1410000011 1410000012 1410000099"
for NID in $NIDS; do
  OLDID=$(curl -s -b /tmp/cum_super.txt "$BASE/api/admin/users?q=$NID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['users'][0]['id'] if d['users'] else '')" 2>/dev/null)
  [ -n "$OLDID" ] && curl -s -b /tmp/cum_super.txt -o /dev/null -X DELETE "$BASE/api/admin/users/$OLDID?confirm=true"
done

CLASS1_ID=$(curl -s -b /tmp/cum_a1.txt $BASE/api/classes | python3 -c "import sys,json; print(json.load(sys.stdin)['classrooms'][0]['id'])")
CLASS1_NAME=$(curl -s -b /tmp/cum_a1.txt $BASE/api/classes | python3 -c "import sys,json; print(json.load(sys.stdin)['classrooms'][0]['name'])")
echo "  (کلاس مدرسه۱: $CLASS1_NAME)"

SCHOOL1_ID=$(curl -s -b /tmp/cum_super.txt "$BASE/api/schools" | python3 -c "import sys,json; print([s['id'] for s in json.load(sys.stdin)['schools'] if 'بهشتی' in s['name']][0])")

echo "── ۱) افزودن تکی (مدیر مدرسه) ──"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"زهرا","lastName":"محمدی","role":"STUDENT","nationalId":"1410000001","classroomId":"'$CLASS1_ID'","phone":"09120001001"}')
check "ایجاد دانش‌آموز = 201" 201 "$R"

R=$(curl -s -b /tmp/cum_a1.txt -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"زهرا","lastName":"محمدی","role":"STUDENT","nationalId":"1410000001"}' -o /dev/null -w "%{http_code}")
check "کدملی تکراری = 409" 409 "$R"

R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"حسین","lastName":"کریمی","role":"TEACHER","nationalId":"1410000002","phone":"09120001002"}')
check "ایجاد معلم بدون کلاس = 201" 201 "$R"

R=$(curl -s -b /tmp/cum_a1.txt -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"بد","lastName":"بدنامه","role":"STUDENT","nationalId":"abc123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','')[:20])")
echo "  (خطای کدملی غیرعددی: $R)"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"بد","lastName":"بدنامه","role":"STUDENT","nationalId":"abc123"}')
check "کدملی حرفی = 400" 400 "$R"

R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"ا","lastName":"تک‌حرفی","role":"STUDENT","nationalId":"1410000003"}')
check "نام تک‌حرفی = 400" 400 "$R"

R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"مونا","lastName":"سلطانی","role":"STUDENT","nationalId":"1410000003","phone":"09120001001"}')
check "شماره تکراری = 409" 409 "$R"

R=$(curl -s -b /tmp/cum_t1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"تلاش","lastName":"معلم","role":"STUDENT","nationalId":"1410000003"}')
check "معلم اجازه ایجاد ندارد = 403" 403 "$R"

# کلاس دانش‌آموز ثبت شده؟
ENR=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000001" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['users'][0]['enrollments'][0]['classroom']['name'] if d['users'][0]['enrollments'] else 'NONE')")
check "ثبت‌نام کلاسی دانش‌آموز" "$CLASS1_NAME" "$ENR"

# ورود با نام کاربری = کدملی و رمز پیش‌فرض
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000001","password":"123456","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود دانش‌آموز جدید با 1410000001/123456 = 200" 200 "$R"

echo "── ۲) افزودن گروهی دانش‌آموزان ──"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users/bulk -H 'Content-Type: application/json' -d '{"rows":[{"firstName":"علی","lastName":"رضایی","nationalId":"1410000004"}]}')
check "بدون کلاس = 400" 400 "$R"

BULK=$(curl -s -b /tmp/cum_a1.txt -X POST $BASE/api/users/bulk -H 'Content-Type: application/json' -d '{"classroomId":"'$CLASS1_ID'","rows":[{"firstName":"علی","lastName":"رضایی","nationalId":"1410000004","phone":"09120001004"},{"firstName":"سارا","lastName":"احمدی","nationalId":"۱۴۱۰۰۰۰۰۰۵"},{"firstName":"تکراری","lastName":"موجود","nationalId":"1410000001"},{"firstName":"بد","lastName":"شماره","nationalId":"1410000006","phone":"09120001004"}]}')
CREATED=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['created'])")
check "گروهی: ۲ از ۴ ثبت شد" 2 "$CREATED"
DUPERR=$(echo "$BULK" | python3 -c "import sys,json; d=json.load(sys.stdin); print('error' if any(r['status']=='error' and r['nationalId']=='1410000001' for r in d['results']) else 'none')")
check "ردیف کدملی تکراری خطا دارد" "error" "$DUPERR"
PHERR=$(echo "$BULK" | python3 -c "import sys,json; d=json.load(sys.stdin); print('error' if any(r['status']=='error' and 'شماره' in (r.get('error') or '') for r in d['results']) else 'none')")
check "ردیف شماره تکراری خطا دارد" "error" "$PHERR"
# ارقام فارسی نرمال شد؟
FAOK=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000005" | python3 -c "import sys,json; d=json.load(sys.stdin); print('found' if d['users'] else 'none')")
check "کدملی با ارقام فارسی ثبت شد" "found" "$FAOK"

echo "── ۳) ایمپورت اکسل (API) ──"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users/import -H 'Content-Type: application/json' -d '{"rows":[{"firstName":"بدون","lastName":"کلاس","nationalId":"1410000007"}],"commit":false}')
check "ایمپورت بدون کلاس = 400" 400 "$R"

IMP=$(curl -s -b /tmp/cum_a1.txt -X POST $BASE/api/users/import -H 'Content-Type: application/json' -d '{"classroomId":"'$CLASS1_ID'","rows":[{"firstName":"نگار","lastName":"حیدری","role":"دانش‌آموز","nationalId":"1410000007"},{"firstName":"رضا","lastName":"موسوی","role":"معلم","nationalId":"1410000008"},{"firstName":"پیش‌فرض","lastName":"دانش‌آموز","nationalId":"1410000009"},{"firstName":"نقش","lastName":"نامعتبر","role":"مدیرعامل","nationalId":"1410000010"}],"commit":false}')
VALID=$(echo "$IMP" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['valid'])")
check "اعتبارسنجی ایمپورت: ۳ از ۴ سالم" 3 "$VALID"
ROLEFA=$(echo "$IMP" | python3 -c "import sys,json; d=json.load(sys.stdin); print([r['role'] for r in d['results'] if r['nationalId']=='1410000008'][0])")
check "برچسب نقش فارسی در پیش‌نمایش" "معلم" "$ROLEFA"

IMP2=$(curl -s -b /tmp/cum_a1.txt -X POST $BASE/api/users/import -H 'Content-Type: application/json' -d '{"classroomId":"'$CLASS1_ID'","rows":[{"firstName":"نگار","lastName":"حیدری","role":"دانش‌آموز","nationalId":"1410000007"},{"firstName":"رضا","lastName":"موسوی","role":"معلم","nationalId":"1410000008"},{"firstName":"پیش‌فرض","lastName":"دانش‌آموز","nationalId":"1410000009"}],"commit":true}')
CREATED2=$(echo "$IMP2" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['created'])")
check "ثبت ایمپورت: ۳ کاربر" 3 "$CREATED2"
# دانش‌آموز پیش‌فرض کلاس گرفت، معلم نه
ENR2=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000009" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['users'][0]['enrollments'] else 'no')")
check "نقش خالی=دانش‌آموز + ثبت کلاس" "yes" "$ENR2"
ENR3=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000008" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['users'][0]['enrollments'] else 'no')")
check "معلم بدون ثبت‌نام کلاسی" "no" "$ENR3"

echo "── ۴) مدیر کل: تکی/گروهی/ایمپورت با فیلد مدرسه ──"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/users/create -H 'Content-Type: application/json' -d '{"firstName":"سعی","lastName":"غیرمجاز","role":"STUDENT","nationalId":"1410000099","schoolId":"'$SCHOOL1_ID'"}')
check "مدیر مدرسه → API مدیر کل = 403" 403 "$R"

R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/users/create -H 'Content-Type: application/json' -d '{"firstName":"نازنین","lastName":"کاظمی","role":"STUDENT","nationalId":"1410000011","schoolId":"'$SCHOOL1_ID'","classroomId":"'$CLASS1_ID'"}')
check "مدیر کل: دانش‌آموز با مدرسه+کلاس = 201" 201 "$R"

R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/users/create -H 'Content-Type: application/json' -d '{"firstName":"مدیر","lastName":"جدید","role":"مدیر مدرسه","nationalId":"1410000012","schoolId":"'$SCHOOL1_ID'"}')
check "مدیر کل: ایجاد مدیر مدرسه = 201" 201 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000012","password":"123456","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر مدرسه جدید = 200" 200 "$R"

SB=$(curl -s -b /tmp/cum_super.txt -X POST $BASE/api/admin/users/bulk -H 'Content-Type: application/json' -d '{"schoolId":"'$SCHOOL1_ID'","classroomId":"'$CLASS1_ID'","rows":[{"firstName":"گروهی","lastName":"مدیرکل","nationalId":"1410000099"}]}')
SBC=$(echo "$SB" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['created'])")
check "مدیر کل: افزودن گروهی = 1" 1 "$SBC"

SI=$(curl -s -b /tmp/cum_super.txt -X POST $BASE/api/admin/users/import -H 'Content-Type: application/json' -d '{"schoolId":"'$SCHOOL1_ID'","classroomId":"'$CLASS1_ID'","rows":[{"firstName":"اکسل","lastName":"مدیرکل","role":"STUDENT","nationalId":"1410000098"}],"commit":true}')
SIC=$(echo "$SI" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['created'])")
check "مدیر کل: ایمپورت = 1" 1 "$SIC"

# مدرسه نامعتبر
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/users/create -H 'Content-Type: application/json' -d '{"firstName":"بد","lastName":"مدرسه","role":"STUDENT","nationalId":"1410000097","schoolId":"invalid-id"}')
check "مدرسه نامعتبر = 404" 404 "$R"

echo "── ۵) رمز ضعیف و قوانین رمز ──"
TID=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000002" | python3 -c "import sys,json; print(json.load(sys.stdin)['users'][0]['id'])")
# فقط حروف — مجاز
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/users/$TID -H 'Content-Type: application/json' -d '{"newPassword":"abcdef"}')
check "رمز فقط حرف (۶) = 200" 200 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000002","password":"abcdef","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود با رمز فقط حرف = 200" 200 "$R"
# فقط عدد — مجاز
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/users/$TID -H 'Content-Type: application/json' -d '{"newPassword":"987654"}')
check "رمز فقط عدد (۶) = 200" 200 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000002","password":"987654","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود با رمز فقط عدد = 200" 200 "$R"
# کوتاه = رد
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/users/$TID -H 'Content-Type: application/json' -d '{"newPassword":"abc12"}')
check "رمز ۵ کاراکتری = 400" 400 "$R"
# مدیر کل هم رمز ضعیف می‌تواند بگذارد
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/users/$TID -H 'Content-Type: application/json' -d '{"newPassword":"111111"}')
check "مدیر کل: رمز فقط عدد = 200" 200 "$R"
# تغییر رمز خود کاربر (me/password) با رمز ضعیف
SM=$(curl -s -c /tmp/cum_s.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000001","password":"123456","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود دانش‌آموز برای تغییر رمز" 200 "$SM"
R=$(curl -s -b /tmp/cum_s.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/me/password -H 'Content-Type: application/json' -d '{"currentPassword":"123456","newPassword":"aaaaaa"}')
check "تغییر رمز خود با رمز ضعیف = 200" 200 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000001","password":"aaaaaa","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود با رمز جدید = 200" 200 "$R"

echo "── ۶) ویرایش نام/نام خانوادگی ──"
R=$(curl -s -b /tmp/cum_a1.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/users/$TID -H 'Content-Type: application/json' -d '{"firstName":"حسین‌علی","lastName":"کریمی‌نژاد"}')
check "ویرایش نام = 200" 200 "$R"
FN=$(curl -s -b /tmp/cum_a1.txt "$BASE/api/users?q=1410000002" | python3 -c "import sys,json; print(json.load(sys.stdin)['users'][0]['fullName'])")
check "fullName ترکیب جدید" "حسین‌علی کریمی‌نژاد" "$FN"
# ویرایش توسط مدیر کل
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/admin/users/$TID -H 'Content-Type: application/json' -d '{"firstName":"حسین","lastName":"کریمی"}')
check "ویرایش مدیر کل = 200" 200 "$R"

echo "── ۷) حساب مدیر مدرسه با کدملی (schools/[id]/admin) ──"
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/schools/$SCHOOL1_ID/admin -H 'Content-Type: application/json' -d '{"firstName":"آزمون","lastName":"مدیریت","nationalId":"1410000090"}')
check "ایجاد حساب مدیر با کدملی = 200" 200 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1410000090","password":"123456","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر ساخته‌شده = 200" 200 "$R"
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/schools/$SCHOOL1_ID/admin -H 'Content-Type: application/json' -d '{"firstName":"آزمون","lastName":"مدیریت","nationalId":"1410000090"}')
check "ثبت مجدد (بازنشانی رمز) = 200" 200 "$R"
R=$(curl -s -b /tmp/cum_super.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/schools/$SCHOOL1_ID/admin -H 'Content-Type: application/json' -d '{"firstName":"بد","lastName":"بد","nationalId":"notanumber"}')
check "کدملی نامعتبر = 400" 400 "$R"

echo "── پاک‌سازی ──"
CLEAN=0
for NID in 1410000001 1410000002 1410000003 1410000004 1410000005 1410000006 1410000007 1410000008 1410000009 1410000010 1410000011 1410000012 1410000099 1410000098 1410000090; do
  OLDID=$(curl -s -b /tmp/cum_super.txt "$BASE/api/admin/users?q=$NID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['users'][0]['id'] if d['users'] else '')" 2>/dev/null)
  if [ -n "$OLDID" ]; then
    curl -s -b /tmp/cum_super.txt -o /dev/null -X DELETE "$BASE/api/admin/users/$OLDID?confirm=true"
    CLEAN=$((CLEAN+1))
  fi
done
echo "  ($CLEAN کاربر تستی حذف شد)"

echo ""
echo "═══ نتیجه: $PASS موفق، $FAIL ناموفق ═══"
[ "$FAIL" = "0" ]
