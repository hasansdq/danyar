#!/bin/bash
# تست E2E مدیریت رسانه‌ها + ماژول استریم مدرسه — واقعی بدون mock
#  A) ماژول استریم: خاموشی مدرسه → پیام رسمی در API و صفحه اتاق؛ روشن‌سازی → رفتار عادی
#  B) سیاست رسانه: فرمت غیرفعال، سقف حجم هر فرمت، سهمیه GB مدرسه
#  C) شمارش دانلود: دریافت کامل/Range/پیش‌نمایش مدیر/dl=1 + ماندگاری ردیف Upload پس از پیام
#  D) گالری: فیلتر (مدرسه/نوع/فرمت/حجم/تاریخ) + مرتب‌سازی
#  E) حذف رسانه + گارد دسترسی غیرمدیر کل
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/daniar-media
TS=$RANDOM$RANDOM
mkdir -p $J

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"$4\"}" > /dev/null; }
code()  { curl -s -b $J/$1.jar -o /tmp/daniar-mout.json -w "%{http_code}" "${@:2}"; }
json()  { python3 -c "import json,sys;d=json.load(open('/tmp/daniar-mout.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

MSG_DISABLED='قابلیت کلاس آنلاین ویدیویی برای مدرسه شما غیر فعال است!'

say "ورود کاربران"
login superadmin Admin@1234 sa superadmin && ok "مدیر کل"
login beheshti.admin Pass@123 adm1 && ok "مدیر مدرسه ۱"
login beheshti.t1 Pass@123 t1 && ok "معلم t1 (beheshti)"
login farzanegan.t1 Pass@123 t4 && ok "معلم farzanegan"

say "شناسه‌ها"
code sa $BASE/api/schools > /dev/null
SCH1=$(json "[s['id'] for s in d['schools'] if 'بهشتی' in s['name']][0]")
SCH2=$(json "[s['id'] for s in d['schools'] if 'فرزانگان' in s['name']][0]")
[ -n "$SCH1" ] && [ -n "$SCH2" ] && ok "دو مدرسه یافت شد" || bad "مدرسه‌ها ($SCH1,$SCH2)"
code t1 $BASE/api/chats > /dev/null
GMATH7=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هفتم۱'][0]")
[ -n "$GMATH7" ] && ok "گروه ریاضی هفتم۱" || bad "گروه"

say "A) ماژول استریم — خاموش‌سازی farzanegan توسط مدیر کل"
code sa -X PATCH $BASE/api/schools/$SCH2 -H 'content-type: application/json' \
  -d "{\"features\":{\"chat\":true,\"dm\":true,\"assignments\":true,\"onlineClass\":false,\"attendance\":true,\"sampleq\":true,\"push\":true}}" > /dev/null
C=$(code t4 $BASE/api/live-sessions)
E=$(json "d['error']")
[ "$C" = 403 ] && [ "$E" = "$MSG_DISABLED" ] && ok "GET live-sessions معلم farzanegan: 403 + متن رسمی" || bad "($C,$E)"
C=$(code t1 $BASE/api/live-sessions)
[ "$C" = 200 ] && ok "معلم beheshti بی‌تأثیر (200)" || bad "بازگشت ($C)"

say "A) بلاک صفحه اتاق جلسه برای مدرسه خاموش (رندر سرور-ساید)"
HTML=$(curl -s -b $J/t4.jar $BASE/live/test-session-id)
echo "$HTML" | grep -q "$MSG_DISABLED" && ok "صفحه /live/[id] پیام رسمی را نشان می‌دهد" || bad "HTML بدون پیام"
echo "$HTML" | grep -q 'لطفاً با پشتیبانی دانیار تماس بگیرید.' && ok "خط دوم پشتیبانی در صفحه هست" || bad "خط پشتیبانی نیست"
HTML2=$(curl -s -b $J/t1.jar $BASE/live/test-session-id)
echo "$HTML2" | grep -q "$MSG_DISABLED" && bad "معلم مدرسه روشن نباید بلاک شود" || ok "معلم مدرسه روشن: بدون پیام بلاک"

say "A) بازگشت ماژول farzanegan به حالت فعال"
code sa -X PATCH $BASE/api/schools/$SCH2 -H 'content-type: application/json' \
  -d "{\"features\":{\"chat\":true,\"dm\":true,\"assignments\":true,\"onlineClass\":true,\"attendance\":true,\"sampleq\":true,\"push\":true}}" > /dev/null
C=$(code t4 $BASE/api/live-sessions)
[ "$C" = 200 ] && ok "پس از روشن‌سازی: 200" || bad "($C)"

say "B) سیاست رسانه — خواندن تنظیمات پیش‌فرض"
C=$(code sa $BASE/api/admin/media/settings)
NF=$(json "len(d['formats'])")
[ "$C" = 200 ] && [ "$NF" = 4 ] && ok "GET settings: ۴ فرمت پیش‌فرض" || bad "($C,$NF)"
Q0=$(json "[s['mediaQuotaGB'] for s in d['schools'] if s['id']=='$SCH2'][0]")
[ "$Q0" = "0" ] && ok "سهمیه پیش‌فرض farzanegan = 0 (نامحدود)" || bad "سهمیه ($Q0)"

say "B) PUT تنظیمات: AUDIO خاموش، FILE سقف ۱MB (بدون سهمیه)"
ARR='[{"format":"IMAGE","enabled":true,"maxMB":8,"extensions":["jpg","jpeg","png","webp","gif"]},{"format":"AUDIO","enabled":false,"maxMB":20,"extensions":["mp3","ogg","wav","m4a","webm","aac"]},{"format":"VIDEO","enabled":true,"maxMB":50,"extensions":["mp4","webm","mov"]},{"format":"FILE","enabled":true,"maxMB":1,"extensions":["pdf","doc","docx","xls","xlsx","ppt","pptx","zip","txt","csv"]}]'
code sa -X PUT $BASE/api/admin/media/settings -H 'content-type: application/json' -d "{\"formats\":$ARR}" > /dev/null
ok "تنظیمات جدید اعمال شد"

say "B) اعمال سیاست در آپلود"
python3 -c "import sys; sys.stdout.buffer.write(b'A'*1536)" > $J/f.jpg
python3 -c "import sys; sys.stdout.buffer.write(b'A'*1572864)" > $J/big.pdf
python3 -c "import sys; sys.stdout.buffer.write(b'A'*1000)" > $J/ok.pdf
python3 -c "import sys; sys.stdout.buffer.write(b'ID3'*100)" > $J/song.mp3
printf 'MZ-not-real' > $J/bad.exe
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/f.jpg;type=image/jpeg" -F "purpose=chat")
[ "$C" = 201 ] && ok "jpg ۱.۵KB مجاز (201)" || bad "($C): $(cat /tmp/daniar-mout.json)"
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/song.mp3;type=audio/mpeg" -F "purpose=chat")
E=$(json "d['error']")
[ "$C" = 415 ] && echo "$E" | grep -q 'صوت' && ok "mp3 با فرمت خاموش: 415 + پیام فارسی" || bad "($C,$E)"
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/big.pdf;type=application/pdf" -F "purpose=chat")
E=$(json "d['error']")
[ "$C" = 413 ] && echo "$E" | grep -q 'حداکثر 1 مگابایت' && ok "pdf ۱.۵MB با سقف ۱MB: 413" || bad "($C,$E)"
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/bad.exe;type=application/octet-stream" -F "purpose=chat")
[ "$C" = 415 ] && ok "exe نامجاز: 415" || bad "($C)"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@$J/ok.pdf;type=application/pdf" -F "purpose=chat")
[ "$C" = 201 ] && ok "pdf ۱KB از مدرسه بدون سهمیه: 201" || bad "($C): $(cat /tmp/daniar-mout.json)"
PDF1=$(json "d['key']")

say "B) سهمیه GB مدرسه — مصرف فعلی farzanegan به‌عنوان سقف (باقی‌مانده صفر)"
code sa $BASE/api/admin/media/settings > /dev/null
USAGE2=$(json "[s['usageBytes'] for s in d['schools'] if s['id']=='$SCH2'][0]")
QUOTA=$(python3 -c "print($USAGE2 / (1024**3))")
code sa -X PUT $BASE/api/admin/media/settings -H 'content-type: application/json' \
  -d "{\"formats\":$ARR,\"quotas\":{\"$SCH2\":$QUOTA}}" > /dev/null
APPLIED=$(json "d['appliedQuotas']")
[ "$APPLIED" = "1" ] && ok "سهمیه = مصرف فعلی farzanegan (باقی‌مانده صفر) اعمال شد" || bad "PUT سهمیه ناموفق"
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/ok.pdf;type=application/pdf" -F "purpose=chat")
E=$(json "d['error']")
[ "$C" = 413 ] && echo "$E" | grep -q 'سهمیه' && ok "آپلود با سهمیه تکمیل: 413 + پیام سهمیه" || bad "($C,$E)"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@$J/ok.pdf;type=application/pdf" -F "purpose=chat")
[ "$C" = 201 ] && ok "مدرسه بدون سهمیه بی‌تأثیر (201)" || bad "($C)"

say "B) بازگردانی سیاست پیش‌فرض + سهمیه نامحدود"
ARRD='[{"format":"IMAGE","enabled":true,"maxMB":8,"extensions":["jpg","jpeg","png","webp","gif"]},{"format":"AUDIO","enabled":true,"maxMB":20,"extensions":["mp3","ogg","wav","m4a","webm","aac"]},{"format":"VIDEO","enabled":true,"maxMB":50,"extensions":["mp4","webm","mov"]},{"format":"FILE","enabled":true,"maxMB":20,"extensions":["pdf","doc","docx","xls","xlsx","ppt","pptx","zip","txt","csv"]}]'
code sa -X PUT $BASE/api/admin/media/settings -H 'content-type: application/json' -d "{\"formats\":$ARRD,\"quotas\":{\"$SCH2\":0}}" > /dev/null
APPLIED=$(json "d['appliedQuotas']")
[ "$APPLIED" = "1" ] && ok "بازگردانی کامل (فرمت‌ها + سهمیه ۰)" || bad "PUT بازگردانی ناموفق"
C=$(code t4 -X POST $BASE/api/uploads -F "file=@$J/song.mp3;type=audio/mpeg" -F "purpose=chat")
[ "$C" = 201 ] && ok "پس از بازگردانی: mp3 دوباره مجاز (201)" || bad "($C): $(cat /tmp/daniar-mout.json)"
MP3=$(json "d['key']")

say "C) شمارش دانلود + ماندگاری ردیف رسانه پس از اتصال به پیام"
python3 -c "import sys; sys.stdout.buffer.write(b'\xff\xd8\xff' + b'B'*120000)" > $J/pic.jpg
C=$(code t1 -X POST $BASE/api/uploads -F "file=@$J/pic.jpg;type=image/jpeg" -F "purpose=chat")
JPG=$(json "d['key']")
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' \
  -d "{\"body\":\"تست پیوست\",\"clientId\":\"att-$TS\",\"attachment\":{\"key\":\"$JPG\"}}")
MID=$(json "d['message']['id']")
[ "$C" = 201 ] && [ -n "$MID" ] && ok "پیام با پیوست ارسال شد" || bad "($C,$MID)"
CNT () { code sa "$BASE/api/admin/media?fmt=$1&pageSize=50" > /dev/null; json "[x['downloadCount'] for x in d['items'] if x['key']=='$2'][0]"; }
curl -s -b $J/t1.jar -o /dev/null $BASE/api/attachments/$MID
N=$(CNT jpg "$JPG")
[ "$N" = "1" ] && ok "ردیف رسانه پس از پیام ماند + دریافت کامل پیوست → شمارش ۱" || bad "شمارش ($N)"
curl -s -b $J/t1.jar -o /dev/null -H 'Range: bytes=0-99' $BASE/api/attachments/$MID
N=$(CNT jpg "$JPG")
[ "$N" = "1" ] && ok "Range 206 شمرده نمی‌شود" || bad "شمارش پس از Range ($N)"
curl -s -b $J/sa.jar -o /dev/null "$BASE/api/admin/media/$JPG/file?preview=1"
N=$(CNT jpg "$JPG")
[ "$N" = "1" ] && ok "پیش‌نمایش مدیر شمرده نمی‌شود" || bad "($N)"
curl -s -b $J/sa.jar -o /dev/null "$BASE/api/admin/media/$JPG/file?dl=1"
N=$(CNT jpg "$JPG")
[ "$N" = "2" ] && ok "dl=1 مدیر → شمارش ۲" || bad "($N)"

say "D) گالری — فیلتر/مرتب‌سازی"
code sa "$BASE/api/admin/media?type=IMAGE&pageSize=50" > /dev/null
T=$(json "len([x for x in d['items'] if x['type']!='IMAGE'])")
[ "$T" = "0" ] && ok "فیلتر نوع IMAGE" || bad "($T)"
code sa "$BASE/api/admin/media?schoolId=$SCH1&pageSize=50" > /dev/null
S=$(json "len([x for x in d['items'] if x['school'] and x['school']['id']!='$SCH1'])")
[ "$S" = "0" ] && ok "فیلتر مدرسه بهشتی" || bad "($S)"
code sa "$BASE/api/admin/media?fmt=pdf&pageSize=50" > /dev/null
P=$(json "len([x for x in d['items'] if not (x['mime'].endswith('/pdf') or x['name'].lower().endswith('.pdf'))])")
[ "$P" = "0" ] && ok "فیلتر فرمت pdf (پسوند یا mime)" || bad "($P)"
code sa "$BASE/api/admin/media?sort=size&order=desc&pageSize=50" > /dev/null
SIZES=$(json "[x['size'] for x in d['items']]")
python3 -c "s=$SIZES; assert s==sorted(s,reverse=True), 'not desc'" && ok "مرتب‌سازی حجیم‌ترین" || bad "سایزها: $SIZES"
code sa "$BASE/api/admin/media?sort=createdAt&order=asc&pageSize=50" > /dev/null
DATES=$(json "[x['createdAt'] for x in d['items']]")
python3 -c "d=$DATES; assert d==sorted(d), 'not asc'" && ok "مرتب‌سازی قدیمی‌ترین" || bad "تاریخ‌ها"
TODAY=$(date +%F)
code sa "$BASE/api/admin/media?from=$TODAY&to=$TODAY&pageSize=50" > /dev/null
NT=$(json "d['summary']['count']")
[ "$NT" -ge 4 ] && ok "فیلتر تاریخ امروز: $NT رسانه" || bad "($NT)"
code sa "$BASE/api/admin/media?minSize=600000&pageSize=50" > /dev/null
MN=$(json "len([x for x in d['items'] if x['size']<600000])")
[ "$MN" = "0" ] && ok "فیلتر حداقل حجم" || bad "($MN)"
code sa "$BASE/api/admin/media?pageSize=2&page=2" > /dev/null
PG=$(json "d['page']")
[ "$PG" = "2" ] && ok "صفحه‌بندی page=2" || bad "($PG)"

say "E) حذف رسانه + گارد دسترسی"
C=$(code t1 -X POST $BASE/api/uploads -F "file=@$J/ok.pdf;type=application/pdf" -F "purpose=avatar")
E=$(json "d['error']")
[ "$C" = 415 ] && echo "$E" | grep -q 'تصویر پروفایل' && ok "avatar باید IMAGE باشد (415)" || bad "($C,$E)"
DELKEY=$(code t1 -X POST $BASE/api/uploads -F "file=@$J/pic.jpg;type=image/jpeg" -F "purpose=chat" > /dev/null; json "d['key']")
C=$(code sa -X DELETE $BASE/api/admin/media/$DELKEY)
[ "$C" = 200 ] && ok "DELETE توسط مدیر کل (200)" || bad "($C)"
C=$(code sa $BASE/api/admin/media/$DELKEY/file)
[ "$C" = 404 ] && ok "فایل حذف‌شده: سرو 404" || bad "($C)"
C=$(code sa -X DELETE $BASE/api/admin/media/$DELKEY)
[ "$C" = 404 ] && ok "حذف تکراری: 404" || bad "($C)"
C=$(code adm1 $BASE/api/admin/media)
[ "$C" = 403 ] && ok "مدیر مدرسه به گالری دسترسی ندارد (403)" || bad "($C)"
C=$(code t1 -X DELETE $BASE/api/admin/media/$JPG)
[ "$C" = 403 ] && ok "معلم حذف نمی‌تواند (403)" || bad "($C)"

say "پاک‌سازی رسانه‌های آزمون"
for K in $PDF1 $MP3 $JPG; do
  [ -n "$K" ] && curl -s -b $J/sa.jar -X DELETE $BASE/api/admin/media/$K > /dev/null
done
code sa "$BASE/api/admin/media?fmt=jpg&pageSize=100" > /dev/null
for K in $(json "' '.join(x['key'] for x in d['items'] if x['name'] in ('f.jpg','pic.jpg','probe.jpg'))"); do
  [ -n "$K" ] && curl -s -b $J/sa.jar -X DELETE $BASE/api/admin/media/$K > /dev/null
done
code sa "$BASE/api/admin/media?fmt=pdf&pageSize=100" > /dev/null
for K in $(json "' '.join(x['key'] for x in d['items'] if x['name'] in ('ok.pdf','big.pdf'))"); do
  [ -n "$K" ] && curl -s -b $J/sa.jar -X DELETE $BASE/api/admin/media/$K > /dev/null
done
code sa $BASE/api/admin/media > /dev/null
LEFT=$(json "d['platform']['count']")
ok "پاک‌سازی انجام شد — رسانه باقی‌مانده پلتفرم: $LEFT"

echo -e "\n════════════════════════════"
echo "نتیجه: $PASS موفق، $FAIL ناموفق"
[ "$FAIL" = 0 ] && echo "✅ همه آزمون‌ها سبز" || echo "❌ شکست‌ها بالا"
exit $FAIL
