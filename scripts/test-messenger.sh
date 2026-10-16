#!/bin/bash
# تست جامع پیام‌رسان دانیار — پیام متنی، کنترل دسترسی، سیاست‌ها، DM، اطلاعیه، فایل
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-test
TS=$RANDOM$RANDOM
mkdir -p $J

say()  { echo -e "\n\033[1m▶ $1\033[0m"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login \
    -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"app\"}" > /dev/null
}

code() { curl -s -b $J/$1.jar -o /tmp/danyar-out.json -w "%{http_code}" "${@:2}"; }
json() { python3 -c "import json,sys;d=json.load(open('/tmp/danyar-out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

say "ورود کاربران"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱"
login beheshti.t1 Pass@123 t1 && ok "معلم t1"
login beheshti.s1 Pass@123 s1 && ok "دانش‌آموز s1"
login beheshti.s2 Pass@123 s2 && ok "دانش‌آموز s2"
login beheshti.s5 Pass@123 s5 && ok "دانش‌آموز s5"
login farzanegan.admin Pass@123 admin2 && ok "مدیر مدرسه ۲"
login farzanegan.t1 Pass@123 t4 && ok "معلم مدرسه ۲"

say "فهرست گفتگوها (خودکار بودن عضویت)"
C=$(code admin1 $BASE/api/chats); N=$(json "len(d['conversations'])")
[ "$C" = 200 ] && [ "$N" -ge 6 ] && ok "مدیر ۱: $N گفتگو (۵ گروه + DM)" || bad "مدیر ۱ گفتگوها ($C,$N)"
C=$(code s1 $BASE/api/chats); NG=$(json "len([c for c in d['conversations'] if c['type']=='GROUP'])")
[ "$C" = 200 ] && [ "$NG" = 3 ] && ok "s1: عضو خودکار ۳ گروه کلاس هفتم۱" || bad "s1 گروه‌ها ($C,$NG)"
C=$(code s5 $BASE/api/chats); NG=$(json "len([c for c in d['conversations'] if c['type']=='GROUP'])")
[ "$NG" = 2 ] && ok "s5: ۲ گروه هشتم۱ (بدون دسترسی به هفتم۱)" || bad "s5 گروه‌ها ($NG)"
ANN=$(code s1 $BASE/api/chats); HASANN=$(json "any('اطلاعیه' in (c['lastMessage']['preview'] if c['lastMessage'] else '') for c in d['conversations'])")
[ "$HASANN" = "True" ] && ok "اطلاعیه مدیر در فهرست گروه دیده می‌شود" || bad "اطلاعیه در فهرست نیست"

say "شناسه‌های گروه‌ها"
code s1 $BASE/api/chats > /dev/null
GMATH7=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هفتم۱'][0]")
GSCI7=$(json "[c['id'] for c in d['conversations'] if c['title']=='علوم هفتم۱'][0]")
code s5 $BASE/api/chats > /dev/null
GMATH8=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هشتم۱'][0]")
GSCI8=$(json "[c['id'] for c in d['conversations'] if c['title']=='علوم هشتم۱'][0]")
code t4 $BASE/api/chats > /dev/null
GLIT9=$(json "[c['id'] for c in d['conversations'] if c['title']=='ادبیات نهم۱'][0]")
echo "  ids: math7=$GMATH7 sci7=$GSCI7 math8=$GMATH8 sci8=$GSCI8 lit9=$GLIT9"

say "ارسال پیام متنی گروهی"
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"تست پیام معلم\",\"clientId\":\"tc-1-$TS\"}")
[ "$C" = 201 ] && ok "معلم پیام فرستاد (201)" || bad "ارسال معلم ($C): $(cat /tmp/danyar-out.json)"
MID=$(json "d['message']['id']")
C=$(code s1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"تست پیام دانش‌آموز\",\"clientId\":\"tc-2-$TS\"}")
[ "$C" = 201 ] && ok "دانش‌آموز عضو پیام فرستاد" || bad "ارسال دانش‌آموز ($C)"
C=$(code s1 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"نفوذ\",\"clientId\":\"tc-x-$TS\"}")
[ "$C" = 404 ] && ok "s1 به گروه کلاس هشتم دسترسی ندارد (404)" || bad "نفوذ بین کلاسی ($C)"
C=$(code t4 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"نفوذ بین مدرسه\",\"clientId\":\"tc-y-$TS\"}")
[ "$C" = 404 ] && ok "معلم مدرسه ۲ به گروه مدرسه ۱ (404)" || bad "جداسازی ارسال ($C)"
C=$(code t4 $BASE/api/chats/group/$GMATH7/messages)
[ "$C" = 404 ] && ok "خواندن پیام‌های مدرسه دیگر (404)" || bad "جداسازی خواندن ($C)"
C=$(code t4 $BASE/api/attachments/$MID)
[ "$C" = 404 ] && ok "دریافت پیوست پیام مدرسه دیگر (404)" || bad "پیوست بین‌مدرسه‌ای ($C)"

say "جلوگیری از پیام تکراری (clientId)"
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"تست پیام معلم\",\"clientId\":\"tc-1-$TS\"}")
D=$(json "d.get('duplicate')")
[ "$C" = 200 ] && [ "$D" = "True" ] && ok "clientId تکراری → duplicate:true بدون ثبت مجدد" || bad "dedupe ($C,$D)"

say "ویرایش و حذف با کنترل مجوز"
C=$(code t1 -X PATCH $BASE/api/messages/$MID -H 'content-type: application/json' -d '{"body":"متن ویرایش‌شده"}')
[ "$C" = 200 ] && ok "نویسنده پیام را ویرایش کرد" || bad "ویرایش نویسنده ($C)"
C=$(code s1 -X PATCH $BASE/api/messages/$MID -H 'content-type: application/json' -d '{"body":"هک"}')
[ "$C" = 403 ] && ok "غیرنویسنده اجازه ویرایش ندارد (403)" || bad "ویرایش غیرنویسنده ($C)"
C=$(code s2 -X DELETE $BASE/api/messages/$MID)
[ "$C" = 403 ] && ok "دانش‌آموز دیگر اجازه حذف ندارد (403)" || bad "حذف غیرمجاز ($C)"
C=$(code admin1 -X DELETE $BASE/api/messages/$MID)
[ "$C" = 200 ] && ok "مدیر مدرسه پیام را حذف کرد" || bad "حذف توسط مدیر ($C)"
C=$(code s1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d '{"body":"حذف خودم","clientId":"tc-del"}')
DID=$(json "d['message']['id']")
C=$(code s1 -X DELETE $BASE/api/messages/$DID)
[ "$C" = 200 ] && ok "کاربر پیام خودش را حذف کرد" || bad "حذف پیام خود ($C)"

say "وضعیت خواندن و شمارنده نخوانده"
C=$(code s2 -X POST $BASE/api/chats/group/$GMATH7/read)
[ "$C" = 200 ] && ok "علامت‌گذاری گروه به‌عنوان خوانده‌شده" || bad "group read ($C)"
C=$(code s2 $BASE/api/chats); U=$(json "[c['unread'] for c in d['conversations'] if c['id']=='$GMATH7'][0]")
[ "$U" = 0 ] && ok "نخوانده گروه صفر شد" || bad "نخوانده گروه ($U)"

say "سیاست ارسال گروه (مجوز پیام)"
C=$(code admin1 -X PATCH $BASE/api/groups/$GMATH8 -H 'content-type: application/json' -d '{"messagePolicy":"STAFF"}')
[ "$C" = 200 ] && ok "سیاست گروه ریاضی هشتم۱ → فقط معلم و مدیر" || bad "ثبت سیاست ($C)"
C=$(code s5 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"تست\",\"clientId\":\"tp-1-$TS\"}")
[ "$C" = 403 ] && ok "دانش‌آموز در حالت STAFF مسدود (403)" || bad "سیاست STAFF دانش‌آموز ($C)"
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"تست معلم\",\"clientId\":\"tp-2-$TS\"}")
[ "$C" = 201 ] && ok "معلم منتسب در حالت STAFF ارسال کرد" || bad "سیاست STAFF معلم ($C)"
C=$(code admin1 -X PATCH $BASE/api/groups/$GMATH8 -H 'content-type: application/json' -d '{"messagePolicy":"ADMINS"}')
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"تست\",\"clientId\":\"tp-3-$TS\"}")
[ "$C" = 403 ] && ok "معلم در حالت ADMINS مسدود (403)" || bad "سیاست ADMINS معلم ($C)"
C=$(code admin1 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"اعلام مدیر\",\"clientId\":\"tp-4-$TS\"}")
[ "$C" = 201 ] && ok "مدیر در حالت ADMINS ارسال کرد" || bad "سیاست ADMINS مدیر ($C)"
code admin1 -X PATCH $BASE/api/groups/$GMATH8 -H 'content-type: application/json' -d '{"messagePolicy":"ALL"}' > /dev/null

say "بایگانی گروه (فقط‌خواندنی)"
code admin1 -X PATCH $BASE/api/groups/$GMATH8 -H 'content-type: application/json' -d '{"archived":true}' > /dev/null
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH8/messages -H 'content-type: application/json' -d "{\"body\":\"تست\",\"clientId\":\"ta-1-$TS\"}")
[ "$C" = 403 ] && ok "ارسال در گروه بایگانی مسدود (403)" || bad "بایگانی ارسال ($C)"
C=$(code s5 $BASE/api/chats/group/$GMATH8/messages)
[ "$C" = 200 ] && ok "تاریخچه گروه بایگانی برای عضو قابل مشاهده است" || bad "خواندن بایگانی ($C)"
code admin1 -X PATCH $BASE/api/groups/$GMATH8 -H 'content-type: application/json' -d '{"archived":false}' > /dev/null

say "قواعد گفتگوی خصوصی"
S1ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.s1&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
S2ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.s2&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
S5ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.s5&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
T1ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.t1&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
T2ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.t2&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
T3ID=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.t3&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
T4ID=$(curl -s -b $J/admin2.jar "$BASE/api/users?q=farzanegan.t1&pageSize=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['users'][0]['id'])" 2>/dev/null)
A2ID=$(curl -s -b $J/admin2.jar $BASE/api/me | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)

C=$(code s1 -X POST $BASE/api/chats/dm/$T2ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام خانم مرادی\",\"clientId\":\"td-1-$TS\"}")
[ "$C" = 201 ] && ok "دانش‌آموز با معلم گروه خودش گفتگو کرد" || bad "DM دانش‌آموز→معلم گروه ($C)"
C=$(code s5 -X POST $BASE/api/chats/dm/$T3ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام\",\"clientId\":\"td-2-$TS\"}")
[ "$C" = 403 ] && ok "s5 با معلم بی‌گروه مشترک مسدود (403)" || bad "DM بدون گروه مشترک ($C)"
C=$(code s1 -X POST $BASE/api/chats/dm/$S2ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام\",\"clientId\":\"td-3-$TS\"}")
[ "$C" = 403 ] && ok "دانش‌آموز↔دانش‌آموز پیش‌فرض غیرفعال (403)" || bad "DM هم‌کلاسی پیش‌فرض ($C)"
C=$(code s1 -X POST $BASE/api/chats/dm/$A2ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام\",\"clientId\":\"td-4-$TS\"}")
[ "$C" = 403 ] && ok "گفتگو بین دو مدرسه مسدود (403)" || bad "جداسازی DM ($C)"
C=$(code s1 -X POST $BASE/api/chats/dm/$T4ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام\",\"clientId\":\"td-5-$TS\"}")
[ "$C" = 403 ] && ok "دانش‌آموز با معلم مدرسه دیگر (403)" || bad "DM بین‌مدرسه معلم ($C)"
C=$(code s1 -X POST $BASE/api/chats/dm/$T1ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام استاد\",\"clientId\":\"td-6-$TS\"}")
[ "$C" = 201 ] && ok "دانش‌آموز با معلم ریاضی خودش" || bad "DM s1→t1 ($C)"
C=$(code admin1 -X POST $BASE/api/chats/dm/$S5ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام امید\",\"clientId\":\"td-7-$TS\"}")
[ "$C" = 201 ] && ok "مدیر با همه کاربران مدرسه‌اش" || bad "DM مدیر ($C)"

say "فعال‌سازی گفتگوی هم‌کلاسی‌ها توسط مدیر"
CID7=$(curl -s -b $J/admin1.jar $BASE/api/classes 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print([c['id'] for c in d['classrooms'] if c['name']=='هفتم۱'][0])" 2>/dev/null)
if [ -z "$CID7" ]; then
  CID7=$(curl -s -b $J/admin1.jar "$BASE/api/users?q=beheshti.s1" > /dev/null; curl -s -b $J/admin1.jar $BASE/api/chats > /dev/null; echo "")
  # از گروه شناسه کلاس را بگیر
  CID7=$(curl -s -b $J/admin1.jar $BASE/api/chats/group/$GMATH7/messages | python3 -c "import json,sys;print(json.load(sys.stdin)['conversation']['subtitle'])" 2>/dev/null)
  CID7=$(curl -s -b $J/admin1.jar $BASE/api/classes | python3 -c "import json,sys;d=json.load(sys.stdin);print([c['id'] for c in d['classrooms'] if c['name']=='هفتم۱'][0])" 2>/dev/null)
fi
code admin1 -X PATCH $BASE/api/classes/$CID7 -H 'content-type: application/json' -d '{"allowStudentDm":true}' > /dev/null
C=$(code s1 -X POST $BASE/api/chats/dm/$S2ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام هم‌کلاسی\",\"clientId\":\"td-8-$TS\"}")
[ "$C" = 201 ] && ok "پس از فعال‌سازی، هم‌کلاسی‌ها گفتگو کردند" || bad "DM هم‌کلاسی فعال ($C)"
code admin1 -X PATCH $BASE/api/classes/$CID7 -H 'content-type: application/json' -d '{"allowStudentDm":false}' > /dev/null
C=$(code s2 -X POST $BASE/api/chats/dm/$S1ID/messages -H 'content-type: application/json' -d "{\"body\":\"دوباره\",\"clientId\":\"td-9-$TS\"}")
[ "$C" = 403 ] && ok "پس از غیرفعال‌سازی مجدد مسدود شد" || bad "غیرفعال‌سازی هم‌کلاسی ($C)"

say "وضعیت خوانده‌شدن در گفتگوی خصوصی"
C=$(code t1 -X POST $BASE/api/chats/dm/$S1ID/messages -H 'content-type: application/json' -d "{\"body\":\"پیام برای خواندن\",\"clientId\":\"tr-1-$TS\"}")
C=$(code t1 $BASE/api/chats/dm/$S1ID/messages); UN=$(json "sum(1 for m in d['messages'] if m['sender']['id'] != '' and m['readAt'] is None and m['sender']['id'] != '$S1ID' and m['sender']['id'] != '')")
# پیام‌های ارسالی t1 بدون readAt (حذف‌شده‌ها مستثنا — read روی حذف‌شده اعمال نمی‌شود و در UI هم نیستند)
SENT_UN=$(json "sum(1 for m in d['messages'] if m['sender']['id']=='$T1ID' and m['readAt'] is None and m['deletedAt'] is None)")
[ "$SENT_UN" -ge 1 ] && ok "تیک پیام خصوصی هنوز خوانده‌نشده" || bad "وضعیت خواندن اولیه ($SENT_UN)"
code s1 -X POST $BASE/api/chats/dm/$T1ID/read > /dev/null
C=$(code t1 $BASE/api/chats/dm/$S1ID/messages); SENT_UN=$(json "sum(1 for m in d['messages'] if m['sender']['id']=='$T1ID' and m['readAt'] is None and m['deletedAt'] is None)")
[ "$SENT_UN" = 0 ] && ok "پس از خواندن توسط s1، تیک خوانده‌شده ثبت شد" || bad "وضعیت خواندن پس از read ($SENT_UN)"

say "جست‌وجوی نام گفتگوها (بدون محتوای پیام‌ها)"
C=$(curl -s -b $J/t1.jar -o /tmp/danyar-out.json -w "%{http_code}" -G $BASE/api/chats/search --data-urlencode "q=ریاضی")
FOUND=$(json "len(d['conversations'])")
[ "$C" = 200 ] && [ "$FOUND" -ge 1 ] && ok "جست‌وجوی نام گفتگو ($FOUND نتیجه)" || bad "جست‌وجوی نام گفتگو ($C,$FOUND)"
C=$(curl -s -b $J/t1.jar -o /tmp/danyar-out.json -w "%{http_code}" -G $BASE/api/chats/search --data-urlencode "q=کسرها")
MF=$(json "len(d['messages'])"); CF=$(json "len(d['conversations'])")
[ "$MF" = 0 ] && [ "$CF" = 0 ] && ok "محتوای پیام‌های درون گفتگو جست‌وجو نمی‌شود" || bad "جست‌وجوی محتوا ($MF,$CF)"
C=$(curl -s -b $J/t1.jar -o /tmp/danyar-out.json -w "%{http_code}" -G $BASE/api/chats/search --data-urlencode "q=باران")
FOUND=$(json "len(d['conversations']) + len(d['messages'])")
[ "$FOUND" = 0 ] && ok "جست‌وجو محدود به گفتگوهای مجاز است" || bad "نشت جست‌وجو ($FOUND)"

say "صفحه‌بندی تدریجی"
C=$(code t1 "$BASE/api/chats/group/$GMATH7/messages?limit=2")
HM=$(json "d['hasMore']"); NM=$(json "len(d['messages'])")
[ "$C" = 200 ] && [ "$HM" = "True" ] && [ "$NM" = 2 ] && ok "limit=2 → hasMore=true" || bad "صفحه‌بندی ($C,$HM,$NM)"
BEFORE=$(json "d['oldestCreatedAt']")
C=$(code t1 "$BASE/api/chats/group/$GMATH7/messages?limit=2&before=$BEFORE")
NM2=$(json "len(d['messages'])")
[ "$C" = 200 ] && [ "$NM2" -ge 1 ] && ok "بارگذاری قدیمی‌تر با before کار می‌کند" || bad "before ($C,$NM2)"

say "اطلاعیه مدیر مدرسه"
C=$(code admin1 -X POST $BASE/api/announcements -H 'content-type: application/json' -d "{\"body\":\"اطلاعیه تستی ورزش روز دوشنبه\",\"classroomIds\":[\"$CID7\"],\"subjectGroupIds\":[]}")
DEL=$(json "d['delivered']")
[ "$C" = 201 ] && [ "$DEL" = 3 ] && ok "اطلاعیه به ۳ گروه کلاس هفتم۱ تحویل شد" || bad "اطلاعیه ($C,$DEL)"
C=$(code admin2 -X POST $BASE/api/announcements -H 'content-type: application/json' -d "{\"body\":\"نفوذ\",\"classroomIds\":[\"$CID7\"],\"subjectGroupIds\":[]}")
[ "$C" = 403 ] && ok "مدیر مدرسه ۲ نمی‌تواند به کلاس مدرسه ۱ اطلاعیه بدهد" || bad "اطلاعیه بین‌مدرسه ($C)"
C=$(code t1 -X POST $BASE/api/announcements -H 'content-type: application/json' -d "{\"body\":\"x\",\"classroomIds\":[\"$CID7\"]}")
[ "$C" = 403 ] && ok "معلم اجازه اطلاعیه ندارد" || bad "اطلاعیه معلم ($C)"
C=$(code s1 $BASE/api/chats/group/$GMATH7/messages)
HAS=$(json "any(m['type']=='ANNOUNCEMENT' and 'ورزش' in m['body'] for m in d['messages'])")
[ "$HAS" = "True" ] && ok "اطلاعیه کلاس هفتم در گروه خودش دیده می‌شود" || bad "اطلاعیه در گروه کلاس ($HAS)"
C=$(code s5 $BASE/api/chats/group/$GSCI8/messages)
HAS=$(json "any(m['type']=='ANNOUNCEMENT' and 'ورزش' in m['body'] for m in d['messages'])")
[ "$HAS" = "False" ] && ok "اطلاعیه کلاس هفتم به گروه هشتم۱ نشتی نکرده" || bad "نشت اطلاعیه بین کلاس ($HAS)"

say "آپلود فایل و پیوست"
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/test.png
C=$(code t1 -X POST $BASE/api/uploads -F "file=@/tmp/test.png;type=image/png")
[ "$C" = 201 ] && ok "آپلود تصویر مجاز (201)" || bad "آپلود png ($C): $(cat /tmp/danyar-out.json)"
KEY=$(json "d['key']"); NAME=$(json "d['name']")
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"نمودار کلاس\",\"clientId\":\"tf-1-$TS\",\"attachment\":{\"key\":\"$KEY\",\"name\":\"$NAME\",\"mime\":\"image/png\",\"size\":70,\"type\":\"IMAGE\"}}")
[ "$C" = 201 ] && ok "پیام با پیوست ارسال شد" || bad "ارسال با پیوست ($C)"
AMID=$(json "d['message']['id']")
C=$(code s1 $BASE/api/attachments/$AMID)
[ "$C" = 200 ] && ok "عضو گروه فایل را می‌گیرد (200)" || bad "دریافت پیوست عضو ($C)"
C=$(code t4 $BASE/api/attachments/$AMID)
[ "$C" = 403 ] || [ "$C" = 404 ] && ok "غیرعضو/مدرسه دیگر فایل را نمی‌گیرد ($C)" || bad "پیوست غیرعضو ($C)"
echo "#!/bin/bash" > /tmp/evil.exe
C=$(code s1 -X POST $BASE/api/uploads -F "file=@/tmp/evil.exe;type=application/x-msdownload")
[ "$C" = 415 ] && ok "نوع فایل خطرناک رد شد (415)" || bad "نوع غیرمجاز ($C)"

say "کاندیدهای گفتگوی جدید (ماتریس)"
C=$(code s1 $BASE/api/chats/candidates)
HAS_ADMIN=$(json "any(c['role']=='SCHOOL_ADMIN' for c in d['candidates'])")
HAS_T2=$(json "any(c['id']=='$T2ID' for c in d['candidates'])")
HAS_S2=$(json "any(c['id']=='$S2ID' for c in d['candidates'])")
[ "$HAS_ADMIN" = "True" ] && [ "$HAS_T2" = "True" ] && ok "s1: مدیر + معلمان گروه‌هایش در فهرست" || bad "کاندید s1"
[ "$HAS_S2" = "False" ] && ok "s1: هم‌کلاسی وقتی غیرفعال است نیست" || bad "کاندید هم‌کلاسی ($HAS_S2)"
C=$(code t1 $BASE/api/chats/candidates)
HAS_S5=$(json "any(c['id']=='$S5ID' for c in d['candidates'])")
[ "$HAS_S5" = "True" ] && ok "t1: دانش‌آموزان گروه‌های خودش (شامل هشتم۱)" || bad "کاندید t1"
C=$(code admin1 $BASE/api/chats/candidates)
HAS_T4=$(json "any(c['id']=='$T4ID' for c in d['candidates'])")
[ "$HAS_T4" = "False" ] && ok "کاندیدها فقط هم‌مدرسه‌ای‌اند" || bad "کاندید بین‌مدرسه"

say "نتیجه نهایی"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ موفق: $PASS   ❌ ناموفق: $FAIL"
[ $FAIL = 0 ] && echo "🎉 همه تست‌ها پاس شد" || echo "⚠️ تست‌های ناموفق بالا را بررسی کنید"
exit $FAIL
