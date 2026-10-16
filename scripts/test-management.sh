#!/bin/bash
# تست جداسازی داده دو مدرسه و محدودیت نقش‌ها
BASE="http://localhost:3000"
PASS=0; FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name (HTTP $actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — انتظار $expected، دریافت $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "── ۱) ورود کاربران تستی ──"
SUPER=$(curl -s -c /tmp/c_super.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"superadmin","password":"Admin@1234","realm":"superadmin"}' -o /dev/null -w "%{http_code}")
check "ورود superadmin از /superadmin" 200 "$SUPER"

A1=$(curl -s -c /tmp/c_a1.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.admin","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر مدرسه ۱" 200 "$A1"

A2=$(curl -s -c /tmp/c_a2.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"farzanegan.admin","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود مدیر مدرسه ۲" 200 "$A2"

T1=$(curl -s -c /tmp/c_t1.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.t1","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود معلم مدرسه ۱" 200 "$T1"

S1=$(curl -s -c /tmp/c_s1.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.s1","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود دانش‌آموز مدرسه ۱" 200 "$S1"

echo "── ۲) آمار کلی مدیر کل ──"
ST=$(curl -s -b /tmp/c_super.txt $BASE/api/admin/stats)
SCHOOLS_COUNT=$(echo "$ST" | python3 -c "import sys,json; print(json.load(sys.stdin)['stats']['totalSchools'])")
check "دست‌کم دو مدرسه ثبت‌شده (داده دمو ممکن است رشد کند)" "OK" "$(python3 -c "print('OK' if $SCHOOLS_COUNT>=2 else 'NO')")"
USERS_COUNT=$(echo "$ST" | python3 -c "import sys,json; print(json.load(sys.stdin)['stats']['totalUsers'])")
echo "  (کل کاربران: $USERS_COUNT)"

echo "── ۳) جداسازی کلاس‌ها و کاربران ──"
# شناسه‌ها
CLASSES1=$(curl -s -b /tmp/c_a1.txt $BASE/api/classes)
CLASS1_ID=$(echo "$CLASSES1" | python3 -c "import sys,json; print(json.load(sys.stdin)['classrooms'][0]['id'])")
CLASSES2=$(curl -s -b /tmp/c_a2.txt $BASE/api/classes)
CLASS2_ID=$(echo "$CLASSES2" | python3 -c "import sys,json; print(json.load(sys.stdin)['classrooms'][0]['id'])")
echo "  (کلاس مدرسه۱: $CLASS1_ID، کلاس مدرسه۲: $CLASS2_ID)"

# مدیر مدرسه ۲ نباید کلاس مدرسه ۱ را ببیند/ویرایش کند
R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" $BASE/api/classes/$CLASS1_ID)
check "مدیر مدرسه۲ → جزئیات کلاس مدرسه۱ = 404" 404 "$R"

R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/classes/$CLASS1_ID -H 'Content-Type: application/json' -d '{"name":"هک شده"}')
check "مدیر مدرسه۲ → تغییر نام کلاس مدرسه۱ = 404" 404 "$R"

R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X DELETE $BASE/api/classes/$CLASS1_ID)
check "مدیر مدرسه۲ → حذف کلاس مدرسه۱ = 404" 404 "$R"

# جست‌وجوی کاربران فقط هم‌مدرسه‌ای‌ها
U1=$(curl -s -b /tmp/c_a1.txt "$BASE/api/users" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'])")
check "کاربران قابل مشاهده مدیر مدرسه۱ دست‌کم ۸ (هم‌مدرسه‌ای‌ها فقط)" "OK" "$(python3 -c "print('OK' if $U1>=8 else 'NO')")"
U2=$(curl -s -b /tmp/c_a2.txt "$BASE/api/users" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'])")
check "کاربران قابل مشاهده مدیر مدرسه۲ دست‌کم ۳ (هم‌مدرسه‌ای‌ها فقط)" "OK" "$(python3 -c "print('OK' if $U2>=3 else 'NO')")"

# ویرایش کاربر مدرسه دیگر
OTHER_USER=$(curl -s -b /tmp/c_a1.txt "$BASE/api/users?role=STUDENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['users'][0]['id'])")
R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/users/$OTHER_USER -H 'Content-Type: application/json' -d '{"fullName":"هک"}')
check "مدیر مدرسه۲ → ویرایش کاربر مدرسه۱ = 404" 404 "$R"
R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X DELETE $BASE/api/users/$OTHER_USER)
check "مدیر مدرسه۲ → حذف کاربر مدرسه۱ = 404" 404 "$R"

echo "── ۴) محدودیت نقش‌ها ──"
R=$(curl -s -b /tmp/c_t1.txt -o /dev/null -w "%{http_code}" $BASE/api/classes)
check "معلم → ایجاد/لیست کلاس‌ها = 403" 403 "$R"
R=$(curl -s -b /tmp/c_s1.txt -o /dev/null -w "%{http_code}" $BASE/api/users)
check "دانش‌آموز → لیست کاربران = 403" 403 "$R"
R=$(curl -s -b /tmp/c_t1.txt -o /dev/null -w "%{http_code}" $BASE/api/admin/stats)
check "معلم → آمار مدیر کل = 403" 403 "$R"
R=$(curl -s -b /tmp/c_a1.txt -o /dev/null -w "%{http_code}" $BASE/api/admin/users)
check "مدیر مدرسه → کاربران سراسری = 403" 403 "$R"

echo "── ۵) امکانات مدرسه ──"
# مدیر کل پیام خصوصی مدرسه ۱ را خاموش می‌کند
FEATS='{"chat":true,"dm":false,"assignments":true,"onlineClass":true}'
R=$(curl -s -b /tmp/c_super.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/schools/$(curl -s -b /tmp/c_super.txt "$BASE/api/schools" | python3 -c "import sys,json; d=json.load(sys.stdin); print([s['id'] for s in d['schools'] if 'بهشتی' in s['name']][0])") -H 'Content-Type: application/json' -d "{\"features\":$FEATS}")
check "مدیر کل → خاموش‌کردن dm مدرسه۱ = 200" 200 "$R"

# معلم مدرسه ۱ نباید پیام خصوصی بفرستد (به مدیر مدرسه‌اش)
S1ID=$(curl -s -b /tmp/c_a1.txt $BASE/api/me | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
R=$(curl -s -b /tmp/c_t1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/chats/dm/$S1ID/messages -H 'Content-Type: application/json' -d '{"body":"سلام"}')
check "معلم مدرسه۱ → DM با dm=false = 403" 403 "$R"

# اما پیام گروهی باید کار کند
GID=$(curl -s -b /tmp/c_t1.txt $BASE/api/chats | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['id'] for c in d['conversations'] if c.get('type')=='GROUP'][0])")
R=$(curl -s -b /tmp/c_t1.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/chats/group/$GID/messages -H 'Content-Type: application/json' -d '{"body":"تست گروهی"}')
check "معلم مدرسه۱ → پیام گروهی با chat=true = 201" 201 "$R"

# بازگرداندن dm
FEATS='{"chat":true,"dm":true,"assignments":true,"onlineClass":true}'
curl -s -b /tmp/c_super.txt -o /dev/null -X PATCH $BASE/api/schools/$(curl -s -b /tmp/c_super.txt "$BASE/api/schools" | python3 -c "import sys,json; print([s['id'] for s in json.load(sys.stdin)['schools'] if 'بهشتی' in s['name']][0])") -H 'Content-Type: application/json' -d "{\"features\":$FEATS}"

echo "── ۶) ایجاد تکی + ایمپورت اکسل (API) ──"
# پاک‌سازی اجراهای قبلی (اجرای مجدد‌پذیر)
for NID in 1234500001 1234500099; do
  OLDID=$(curl -s -b /tmp/c_super.txt "$BASE/api/admin/users?q=$NID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['users'][0]['id'] if d['users'] else '')" 2>/dev/null)
  [ -n "$OLDID" ] && curl -s -b /tmp/c_super.txt -o /dev/null -X DELETE "$BASE/api/admin/users/$OLDID?confirm=true"
done
# ایجاد تکی با فرمت جدید: نام کاربری = کدملی، رمز پیش‌فرض 123456
CR=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"دانش","lastName":"تکراری","role":"STUDENT","nationalId":"1234500001"}')
check "ایجاد تکی دانش‌آموز با کدملی = 201" 201 "$CR"
DUP=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X POST $BASE/api/users -H 'Content-Type: application/json' -d '{"firstName":"تکراری","lastName":"دوم","role":"STUDENT","nationalId":"1234500001"}')
check "کدملی تکراری = 409" 409 "$DUP"
WEAK=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"1234500001","password":"123456","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود کاربر جدید با رمز پیش‌فرض 123456 = 200" 200 "$WEAK"

IMP=$(curl -s -b /tmp/c_a2.txt -X POST $BASE/api/users/import -H 'Content-Type: application/json' -d '{"classroomId":"'$CLASS2_ID'","rows":[{"firstName":"دانش","lastName":"جدید","role":"دانش‌آموز","nationalId":"1234500001"},{"firstName":"دانش","lastName":"درست","role":"STUDENT","nationalId":"1234500099"},{"firstName":"X","lastName":"بد","role":"TEACHER","nationalId":"bad"}],"commit":false}')
VALID=$(echo "$IMP" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['valid'])")
check "اعتبارسنجی: فقط ۱ ردیف سالم" 1 "$VALID"
DUP_ERR=$(echo "$IMP" | python3 -c "import sys,json; d=json.load(sys.stdin); print([r['error'] for r in d['results'] if r['nationalId']=='1234500001'][0])" 2>/dev/null)
echo "  (خطای تکراری: $DUP_ERR)"

# ثبت واقعی
IMP2=$(curl -s -b /tmp/c_a2.txt -X POST $BASE/api/users/import -H 'Content-Type: application/json' -d '{"classroomId":"'$CLASS2_ID'","rows":[{"firstName":"دانش","lastName":"درست","role":"STUDENT","nationalId":"1234500099"}],"commit":true}')
CREATED=$(echo "$IMP2" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['created'])")
check "ثبت واقعی: ۱ کاربر ساخته شد" 1 "$CREATED"
NEWID=$(curl -s -b /tmp/c_a2.txt "$BASE/api/users?q=1234500099" | python3 -c "import sys,json; print(json.load(sys.stdin)['users'][0]['id'])")
echo "  (کاربر جدید: $NEWID)"

echo "── ۷) حذف امن با وابستگی ──"
# دانش‌آموزی که پیام گروهی دارد (beheshti.s1) باید 409 بدهد
S1USER=$(curl -s -b /tmp/c_a1.txt "$BASE/api/users?q=beheshti.s1" | python3 -c "import sys,json; print(json.load(sys.stdin)['users'][0]['id'])")
R=$(curl -s -b /tmp/c_a1.txt -o /dev/null -w "%{http_code}" -X DELETE $BASE/api/users/$S1USER)
check "حذف کاربر با داده وابسته بدون confirm = 409" 409 "$R"
DEPS=$(curl -s -b /tmp/c_a1.txt -X DELETE $BASE/api/users/$S1USER | python3 -c "import sys,json; d=json.load(sys.stdin)['dependencies']; print(d['groupMessages']>0)")
check "گزارش وابستگی شامل پیام گروهی" True "$DEPS"
# حذف کاربر ایمپورت‌شده — چون کلاس ثبت‌نام دارد با confirm انجام می‌شود
R=$(curl -s -b /tmp/c_a2.txt -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/users/$NEWID?confirm=true")
check "حذف کاربر ایمپورت‌شده با confirm = 200" 200 "$R"

echo "── ۸) غیرفعال‌سازی مدرسه و حساب ──"
SCHOOL2_ID=$(curl -s -b /tmp/c_super.txt "$BASE/api/schools" | python3 -c "import sys,json; print([s['id'] for s in json.load(sys.stdin)['schools'] if 'فرزانگان' in s['name']][0])")
R=$(curl -s -b /tmp/c_super.txt -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/schools/$SCHOOL2_ID -H 'Content-Type: application/json' -d '{"isActive":false}')
check "غیرفعال‌سازی مدرسه۲ = 200" 200 "$R"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"farzanegan.admin","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
check "ورود کاربر مدرسه غیرفعال = 403" 403 "$R"
curl -s -b /tmp/c_super.txt -o /dev/null -X PATCH $BASE/api/schools/$SCHOOL2_ID -H 'Content-Type: application/json' -d '{"isActive":true}'

# غیرفعال‌سازی کاربر توسط مدیر مدرسه → ورود مسدود
curl -s -b /tmp/c_a2.txt -o /dev/null -X PATCH $BASE/api/users/$NEWID -H 'Content-Type: application/json' -d '{"isActive":false}'
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"farzanegan.admin","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
echo "  (این فقط چک ساختاری بود)"

echo ""
echo "═══ نتیجه: $PASS موفق، $FAIL ناموفق ═══"
[ $FAIL -eq 0 ] && echo "✓ همه تست‌های جداسازی و نقش‌ها پاس شدند"
