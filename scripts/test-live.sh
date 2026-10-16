#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست جامع کلاس آنلاین دانیار — API: ایجاد جلسه بی‌صدا (بدون اعلان)،
# اعلام شروع کلاس فقط توسط میزبان (ضدتکرار قطعی با announcedAt)،
# پیام دعوت خودکار + اعلان فقط در لحظه اعلام، مجوز ورود نقش‌محور،
# یک جلسه فعال در هر کلاس، پایان جلسه، جداسازی مدرسه‌ای و گیت امکانات
# (ورود/رله WebRTC/چت/مهلت معلم در scripts/test-live-socket.ts به‌صورت واقعی تست می‌شود)
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-live
mkdir -p $J

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar [$4=realm]
  local realm="${4:-app}"
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"$realm\"}" > /dev/null
}
code() { curl -s -b $J/$1.jar -o $J/out.json -w "%{http_code}" "${@:2}"; }
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

say "ورود کاربران"
login superadmin Admin@1234 sa superadmin && ok "superadmin"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱"
login beheshti.t1 Pass@123 t1 && ok "معلم t1 (ریاضی هفتم۱/هشتم۱)"
login beheshti.t2 Pass@123 t2 && ok "معلم t2 (علوم — منتسب به کلاس هفتم۱)"
login beheshti.t3 Pass@123 t3 && ok "معلم t3 (ادبیات — فقط کلاس هفتم۱)"
login beheshti.s1 Pass@123 s1 && ok "دانش‌آموز s1 (هفتم۱)"
login beheshti.s5 Pass@123 s5 && ok "دانش‌آموز s5 (هشتم۱)"
login farzanegan.t1 Pass@123 ft1 && ok "معلم مدرسه ۲"
login farzanegan.s1 Pass@123 fs1 && ok "دانش‌آموز مدرسه ۲"
login farzanegan.admin Pass@123 fadmin && ok "مدیر مدرسه ۲"

say "پاک‌سازی جلسات فعال باقی‌مانده از هر اجرا/اسکریپتی (هر دو مدرسه)"
# همه مدیران مدرسه می‌توانند جلسات مدرسه خودشان را پایان دهند؛
# این پاک‌سازی جلسات جامانده از دیگر مجموعه‌تست‌ها را هم پوشش می‌دهد
for admin_jar in t1 admin1 fadmin; do
  IDS=$(curl -s -b $J/$admin_jar.jar $BASE/api/live-sessions | python3 -c "import json,sys;d=json.load(sys.stdin);rows=d.get('classrooms') or d.get('activeSessions') or [];print(' '.join([(r.get('activeSession') or r)['id'] for r in rows if (r.get('activeSession') or r)]))" 2>/dev/null)
  for s in $IDS; do
    code $admin_jar -X POST "$BASE/api/live-sessions/$s/end" > /dev/null && ok "جلسه باقی‌مانده $s پایان یافت (پاک‌سازی $admin_jar)"
  done
done

say "شناسایی کلاس‌ها و گروه‌ها"
code t1 $BASE/api/live-sessions
CLS7=$(json "[c['id'] for c in d['classrooms'] if c['name']=='هفتم۱'][0]")
GMATH7=$(json "[g['id'] for g in [c for c in d['classrooms'] if c['name']=='هفتم۱'][0]['groups'] if g['name']=='ریاضی هفتم۱'][0]")
GSCI7=$(json "[g['id'] for g in [c for c in d['classrooms'] if c['name']=='هفتم۱'][0]['groups'] if g['name']=='علوم هفتم۱'][0]")
echo "  class7=$CLS7 math7=$GMATH7 sci7=$GSCI7"
code ft1 $BASE/api/live-sessions > /dev/null
FCLS=$(json "d['classrooms'][0]['id']")
FGROUP=$(json "d['classrooms'][0]['groups'][0]['id']")
code fs1 $BASE/api/live-sessions > /dev/null
FSCLASS=$(json "[c['id'] for c in d['classrooms']][0]" 2>/dev/null)

say "ایجاد جلسه (فقط معلم منتسب، گروه اطلاع‌رسانی از همان کلاس)"
C=$(code s1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$GMATH7\",\"title\":\"جلسه دانش‌آموزی\"}")
[ "$C" = 403 ] && ok "دانش‌آموز نمی‌تواند جلسه بسازد (403)" || bad "ساخت جلسه توسط دانش‌آموز ($C)"
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$FCLS\",\"notifyGroupId\":\"$FGROUP\",\"title\":\"نفوذ بین مدرسه‌ای\"}")
[ "$C" = 404 ] && ok "معلم مدرسه ۱ به کلاس مدرسه ۲ دسترسی ندارد (404)" || bad "نفوذ بین‌مدرسه ($C)"
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$FGROUP\",\"title\":\"گروه نامربوط\"}")
[ "$C" = 400 ] && ok "گروه اطلاع‌رسانی باید از گروه‌های همان کلاس باشد (400)" || bad "گروه خارج از کلاس ($C)"
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$GMATH7\",\"title\":\"\"}")
[ "$C" = 400 ] && ok "عنوان خالی رد شد (400)" || bad "عنوان خالی ($C)"

say "ساخت جلسه — بدون هیچ اعلانی (اعلام مرحله جداگانه دارد)"
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$GMATH7\",\"title\":\"رفع اشکال فصل ۳\"}")
[ "$C" = 201 ] && ok "معلم جلسه کلاس هفتم۱ را ساخت (201)" || bad "ایجاد جلسه ($C): $(cat $J/out.json)"
SID=$(json "d['id']")
echo "  session=$SID"

# هیچ پیام دعوت و هیچ اعلانی نباید ساخته شده باشد
code t1 "$BASE/api/chats/group/$GMATH7/messages?limit=10"
INV_BEFORE=$(json "len([m for m in d['messages'] if m.get('liveSessionId')=='$SID'])")
[ "$INV_BEFORE" = "0" ] && ok "قبل از اعلام، هیچ پیام دعوتی در گروه منتشر نشد" || bad "پیام دعوت قبل از اعلام ساخته شد! ($INV_BEFORE)"
code s1 $BASE/api/notifications
NOT_BEFORE=$(json "len([n for n in d['items'] if n.get('link')=='/live/$SID'])")
[ "$NOT_BEFORE" = "0" ] && ok "قبل از اعلام، هیچ اعلانی برای دانش‌آموز ثبت نشد" || bad "اعلان قبل از اعلام ساخته شد! ($NOT_BEFORE)"
code t1 "$BASE/api/live-sessions"
ANN_NULL=$(json "[c['activeSession']['announcedAt'] for c in d['classrooms'] if c['activeSession'] and c['activeSession']['id']=='$SID'][0]")
[ "$ANN_NULL" = "None" ] && ok "announcedAt جلسه تازه null است (سوییچ روشن؛ در انتظار استریم)" || bad "announcedAt اولیه ($ANN_NULL)"

say "اعلام شروع — فقط میزبان؛ ماتریس دسترسی"
C=$(code s1 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 403 ] && ok "اعلام توسط دانش‌آموز همان کلاس رد شد (403)" || bad "اعلام توسط s1 ($C)"
C=$(code s5 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 404 ] && ok "اعلام توسط دانش‌آموز کلاس دیگر رد شد (404)" || bad "اعلام توسط s5 ($C)"
C=$(code ft1 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 404 ] && ok "اعلام توسط معلم مدرسه ۲ رد شد (404)" || bad "اعلام بین‌مدرسه ($C)"
C=$(code t2 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 403 ] && ok "اعلام توسط معلم منتسب اما غیرمیزبان رد شد (403)" || bad "اعلام توسط t2 ($C)"

C=$(code t1 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 200 ] && ok "میزبان شروع کلاس را اعلام کرد (200)" || bad "اعلام توسط میزبان ($C): $(cat $J/out.json)"
AUD=$(json "d.get('audience',0)")
echo "  مخاطبان اعلام: $AUD"
[ "$AUD" -ge 1 ] 2>/dev/null && ok "اعلام مخاطب واقعی داشت (دانش‌آموزان گروه)" || bad "مخاطب اعلام صفر بود"

say "پس از اعلام: پیام دعوت + اعلان درون‌برنامه‌ای + announcedAt"
code t1 "$BASE/api/chats/group/$GMATH7/messages?limit=10"
TYPE=$(json "[m['type'] for m in d['messages'] if m.get('liveSessionId')=='$SID'][-1]")
LIVEID=$(json "[m['liveSessionId'] for m in d['messages'] if m.get('liveSessionId')=='$SID'][-1]")
[ "$TYPE" = "LIVE_INVITE" ] && ok "پیام دعوت با نوع LIVE_INVITE فقط پس از اعلام منتشر شد" || bad "نوع پیام دعوت ($TYPE)"
[ "$LIVEID" = "$SID" ] && ok "پیام دعوت به جلسه متصل است" || bad "liveSessionId پیام ($LIVEID vs $SID)"
code s1 $BASE/api/notifications
NT=$(json "[n['type'] for n in d['items'] if n.get('link')=='/live/$SID'][0]" 2>/dev/null)
[ "$NT" = "LIVE_SESSION_NEW" ] && ok "اعلان «شروع کلاس» برای دانش‌آموز گروه ثبت شد" || bad "اعلان جلسه ($NT)"
code t1 "$BASE/api/live-sessions"
ANN_SET=$(json "[c['activeSession']['announcedAt'] is not None for c in d['classrooms'] if c['activeSession'] and c['activeSession']['id']=='$SID'][0]")
[ "$ANN_SET" = "True" ] && ok "announcedAt در فهرست معلم ثبت شد" || bad "announcedAt فهرست ($ANN_SET)"
code s1 "$BASE/api/live-sessions/$SID"
ANN_DETAIL=$(json "d['announcedAt'] is not None")
[ "$ANN_DETAIL" = "True" ] && ok "announcedAt در جزئیات جلسه هم دیده می‌شود" || bad "announcedAt جزئیات"

say "اعلام مجدد — بدون هیچ تکراری (idempotent)"
C=$(code t1 -X POST "$BASE/api/live-sessions/$SID/announce")
ALR=$(json "d.get('alreadyAnnounced')")
[ "$C" = 200 ] && [ "$ALR" = "True" ] && ok "اعلام مجدد → alreadyAnnounced=true" || bad "اعلام مجدد ($C): $(cat $J/out.json)"
code t1 "$BASE/api/chats/group/$GMATH7/messages?limit=20"
INV_COUNT=$(json "len([m for m in d['messages'] if m.get('liveSessionId')=='$SID'])")
[ "$INV_COUNT" = "1" ] && ok "پیام دعوت همچنان فقط یکی است" || bad "پیام دعوت تکراری شد! ($INV_COUNT)"
code s1 $BASE/api/notifications
NOT_COUNT=$(json "len([n for n in d['items'] if n.get('link')=='/live/$SID'])")
[ "$NOT_COUNT" = "1" ] && ok "اعلان همچنان فقط یکی است" || bad "اعلان تکراری شد! ($NOT_COUNT)"

say "فهرست نقش‌محور"
code s1 $BASE/api/live-sessions
AS=$(json "[c['activeSession']['id'] for c in d['classrooms'] if c['activeSession']][0]" 2>/dev/null)
[ "$AS" = "$SID" ] && ok "دانش‌آموز جلسه فعال کلاس خودش را می‌بیند" || bad "فهرست دانش‌آموز ($AS)"
code s5 $BASE/api/live-sessions
S5ACTIVE=$(json "any(c['activeSession'] for c in d['classrooms'])" 2>/dev/null)
[ "$S5ACTIVE" = "False" ] && ok "دانش‌آموز کلاس هشتم جلسه‌ای نمی‌بیند (جلسه مال هفتم۱ است)" || bad "نشت جلسه بین کلاس‌ها"
code admin1 $BASE/api/live-sessions
AC=$(json "d['activeSessions'][0]['id']" 2>/dev/null)
[ "$AC" = "$SID" ] && ok "مدیر مدرسه جلسه فعال مدرسه خودش را می‌بیند" || bad "فهرست مدیر ($AC)"
code fadmin $BASE/api/live-sessions
FEMPTY=$(json "d['activeSessions']" 2>/dev/null)
[ "$FEMPTY" = "[]" ] && ok "مدیر مدرسه ۲ جلسه مدرسه ۱ را نمی‌بیند (جداسازی)" || bad "نشت بین‌مدرسه مدیر ($FEMPTY)"

say "جزئیات جلسه — ماتریس دسترسی"
C=$(code s1 "$BASE/api/live-sessions/$SID")
[ "$C" = 200 ] && ok "دانش‌آموز همان کلاس جزئیات را می‌بیند (200)" || bad "جزئیات برای s1 ($C)"
ICE=$(json "d['iceServers'][0]['urls'][0]" 2>/dev/null)
echo "  ice=$ICE"
C=$(code s5 "$BASE/api/live-sessions/$SID")
[ "$C" = 404 ] && ok "دانش‌آموز کلاس دیگر جلسه را نمی‌بیند (404)" || bad "دسترسی s5 ($C)"
C=$(code t2 "$BASE/api/live-sessions/$SID")
[ "$C" = 200 ] && ok "معلم منتسب به کلاس (t2 علوم) دسترسی دارد (200)" || bad "دسترسی t2 ($C)"
C=$(code t3 "$BASE/api/live-sessions/$SID")
[ "$C" = 200 ] && ok "معلم منتسب کلاس (t3 ادبیات) دسترسی دارد (200)" || bad "دسترسی t3 ($C)"
C=$(code ft1 "$BASE/api/live-sessions/$SID")
[ "$C" = 404 ] && ok "معلم مدرسه ۲ دسترسی ندارد (404)" || bad "دسترسی ft1 ($C)"
C=$(code fs1 "$BASE/api/live-sessions/$SID")
[ "$C" = 404 ] && ok "دانش‌آموز مدرسه ۲ دسترسی ندارد (404)" || bad "دسترسی fs1 ($C)"
C=$(code admin1 "$BASE/api/live-sessions/$SID")
[ "$C" = 200 ] && ok "مدیر همان مدرسه دسترسی دارد (200)" || bad "دسترسی مدیر ($C)"

say "پایان جلسه — فقط میزبان یا مدیر همان مدرسه"
C=$(code s1 -X POST "$BASE/api/live-sessions/$SID/end")
[ "$C" = 403 ] && ok "دانش‌آموز نمی‌تواند جلسه را پایان دهد (403)" || bad "پایان توسط s1 ($C)"
C=$(code fadmin -X POST "$BASE/api/live-sessions/$SID/end")
[ "$C" = 404 ] && ok "مدیر مدرسه ۲ نمی‌تواند جلسه مدرسه ۱ را پایان دهد (404)" || bad "پایان بین‌مدرسه ($C)"
C=$(code admin1 -X POST "$BASE/api/live-sessions/$SID/end")
[ "$C" = 200 ] && ok "مدیر مدرسه جلسه را پایان داد (200)" || bad "پایان توسط مدیر ($C)"
code s1 "$BASE/api/live-sessions/$SID"
ST=$(json "d['status']")
[ "$ST" = "ENDED" ] && ok "وضعیت جلسه «پایان‌یافته» شد" || bad "وضعیت پس از پایان ($ST)"

say "اعلام شروع برای جلسه پایان‌یافته رد می‌شود"
C=$(code t1 -X POST "$BASE/api/live-sessions/$SID/announce")
[ "$C" = 409 ] && ok "اعلام روی جلسه پایان‌یافته رد شد (409)" || bad "اعلام پس از پایان ($C)"

say "شروع مجدد + پایان توسط غیرمیزبان (برای تست سوکت)"
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$GMATH7\",\"title\":\"جلسه تست سوکت\"}")
[ "$C" = 201 ] && ok "جلسه مجدد پس از پایان قبلی ایجاد شد (201)" || bad "ایجاد مجدد ($C)"
SID2=$(json "d['id']")
C=$(code t2 -X POST "$BASE/api/live-sessions/$SID2/end")
[ "$C" = 403 ] && ok "معلم منتسب اما غیرمیزبان نمی‌تواند پایان دهد (403)" || bad "پایان توسط t2 ($C)"

say "گیت امکانات onlineClass"
SCHOOL1=$(curl -s -b $J/admin1.jar $BASE/api/me | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['schoolId'])")
echo "  school1=$SCHOOL1"
curl -s -b $J/sa.jar -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":true,"dm":true,"assignments":true,"onlineClass":false}}' > /dev/null
C=$(code t1 -X POST $BASE/api/live-sessions -H 'content-type: application/json' -d "{\"classroomId\":\"$CLS7\",\"notifyGroupId\":\"$GMATH7\",\"title\":\"با امکانات خاموش\"}")
[ "$C" = 403 ] && ok "با onlineClass خاموش، شروع جلسه رد شد (403)" || bad "گیت امکانات ($C)"
C=$(code t1 -X POST "$BASE/api/live-sessions/$SID2/announce")
[ "$C" = 403 ] && ok "با onlineClass خاموش، اعلام شروع هم رد شد (403)" || bad "گیت اعلام ($C)"
C=$(code t1 $BASE/api/live-sessions)
[ "$C" = 403 ] && ok "فهرست کلاس آنلاین هم قفل شد (403)" || bad "گیت فهرست ($C)"
curl -s -b $J/sa.jar -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":true,"dm":true,"assignments":true,"onlineClass":true}}' > /dev/null
code t1 $BASE/api/live-sessions
[ -n "$(json "d['classrooms']")" ] && ok "با روشن‌شدن مجدد امکانات، فهرست برمی‌گردد" || bad "بازگشت امکانات"

say "پایداری: جلسه فعال دوم اعلام‌نشده و همچنان ACTIVE است (تست سوکت خودش اعلام می‌کند)"
code t1 "$BASE/api/live-sessions/$SID2"
ST2=$(json "d['status']")
ANN2=$(json "d['announcedAt']")
[ "$ST2" = "ACTIVE" ] && [ "$ANN2" = "None" ] && ok "جلسه SID2 فعال و اعلام‌نشده است" || bad "وضعیت SID2 ($ST2 / $ANN2)"
echo "$SID2" > /tmp/danyar-live/sid2.txt
echo "$CLS7" > /tmp/danyar-live/cls7.txt
echo "$GMATH7" > /tmp/danyar-live/gmath7.txt
echo "$GSCI7" > /tmp/danyar-live/gsci7.txt

echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "نتیجه: $PASS پاس / $FAIL خطا"
[ $FAIL = 0 ] && echo "همه تست‌های API کلاس آنلاین پاس شد ✅" || echo "تست‌های ناموفق وجود دارد ❌"
exit $FAIL
