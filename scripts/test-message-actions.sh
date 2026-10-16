#!/bin/bash
# تست امکانات پیام — سنجاق (نقش‌محور)، هدایت (چندمقصدی با کنترل دسترسی)، سریال‌سازی
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-msg-actions
TS=$RANDOM$RANDOM
mkdir -p $J

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() {
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login \
    -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"app\"}" > /dev/null
}
code() { curl -s -b $J/$1.jar -o /tmp/dma-out.json -w "%{http_code}" "${@:2}"; }
json() { python3 -c "import json,sys;d=json.load(open('/tmp/dma-out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

say "ورود کاربران"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱"
login beheshti.t1    Pass@123 t1     && ok "معلم t1"
login beheshti.s1    Pass@123 s1     && ok "دانش‌آموز s1"
login farzanegan.admin Pass@123 admin2 && ok "مدیر مدرسه ۲"
login beheshti.t2     Pass@123 t2     && ok "معلم t2"
login beheshti.s5     Pass@123 s5     && ok "دانش‌آموز s5"
login farzanegan.t1    Pass@123 t4     && ok "معلم مدرسه ۲"

say "شناسه کاربران (از API)"
code admin1 $BASE/api/users > /dev/null
T1ID=$(json "[u['id'] for u in d['users'] if u['username']=='beheshti.t1'][0]")
S1ID=$(json "[u['id'] for u in d['users'] if u['username']=='beheshti.s1'][0]")
S5ID=$(json "[u['id'] for u in d['users'] if u['username']=='beheshti.s5'][0]")
echo "  ids: t1=$T1ID s1=$S1ID s5=$S5ID"


say "شناسه گفتگوها"
code s1 $BASE/api/chats > /dev/null
GMATH7=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هفتم۱'][0]")
GSCI7=$(json "[c['id'] for c in d['conversations'] if c['title']=='علوم هفتم۱'][0]")
code s5 $BASE/api/chats > /dev/null
GSCI8=$(json "[c['id'] for c in d['conversations'] if c['title']=='علوم هشتم۱'][0]")
code t4 $BASE/api/chats > /dev/null
GLIT9=$(json "[c['id'] for c in d['conversations'] if c['title']=='ادبیات نهم۱'][0]")
echo "  ids: math7=$GMATH7 sci7=$GSCI7 lit9=$GLIT9"

say "آماده‌سازی پیام‌ها"
C=$(code t1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"پیام معلم برای سنجاق $TS\",\"clientId\":\"pin-1-$TS\"}")
[ "$C" = 201 ] && ok "معلم پیام گروهی فرستاد" || bad "ارسال معلم ($C)"
T1MSG=$(json "d['message']['id']")
C=$(code s1 -X POST $BASE/api/chats/group/$GMATH7/messages -H 'content-type: application/json' -d "{\"body\":\"پیام دانش‌آموز $TS\",\"clientId\":\"pin-2-$TS\"}")
[ "$C" = 201 ] && ok "دانش‌آموز پیام گروهی فرستاد" || bad "ارسال دانش‌آموز ($C)"
S1MSG=$(json "d['message']['id']")

# پیام خصوصی s1 → t1
C=$(code s1 -X POST $BASE/api/chats/dm/$T1ID/messages -H 'content-type: application/json' -d "{\"body\":\"سلام از دانش‌آموز $TS\",\"clientId\":\"dm-1-$TS\"}")
[ "$C" = 201 ] && ok "DM دانش‌آموز به معلم" || bad "DM s1→t1 ($C)"
SDM=$(json "d['message']['id']")
# پیام خصوصی t1 → s1
C=$(code t1 -X POST $BASE/api/chats/dm/$S1ID/messages -H 'content-type: application/json' -d "{\"body\":\"پیام خصوصی معلم $TS\",\"clientId\":\"dm-2-$TS\"}")
[ "$C" = 201 ] && ok "DM معلم به دانش‌آموز" || bad "DM t1→s1 ($C)"
T1DM=$(json "d['message']['id']")
C=$(code t2 -X POST $BASE/api/chats/group/$GSCI7/messages -H 'content-type: application/json' -d "{\"body\":\"پیام علوم برای هدایت $TS\",\"clientId\":\"fwd-prep-$TS\"}")
[ "$C" = 201 ] && ok "معلم t2 در علوم پیام فرستاد" || bad "ارسال t2 ($C)"
T2MSG=$(json "d['message']['id']")

say "سنجاق — ماتریس نقش‌ها (گروه)"
C=$(code s1 -X POST $BASE/api/messages/$S1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 403 ] && ok "دانش‌آموز سنجاق نمی‌تواند (403): $(json "d['error']")" || bad "دانش‌آموز سنجاق ($C)"
C=$(code t1 -X POST $BASE/api/messages/$T1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 200 ] && [ "$(json "bool(d['message']['pinnedAt'])")" = "True" ] && ok "معلم پیام را سنجاق کرد" || bad "سنجاق معلم ($C): $(cat /tmp/dma-out.json)"
PINNED_AT=$(json "d['message']['pinnedAt']")
C=$(code t1 -X POST $BASE/api/messages/$T1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 200 ] && [ "$(json "d['message']['pinnedAt']")" = "$PINNED_AT" ] && ok "سنجاق تکراری idempotent است" || bad "سنجاق تکراری ($C)"
C=$(code admin1 -X POST $BASE/api/messages/$S1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 200 ] && ok "مدیر همان مدرسه سنجاق می‌کند" || bad "سنجاق مدیر ($C): $(cat /tmp/dma-out.json)"
C=$(code t4 -X POST $BASE/api/messages/$T1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 404 ] && ok "معلم مدرسه دیگر سنجاق پیام مدرسه ۱ نمی‌تواند (404)" || bad "سنجاق بین‌مدرسه ($C)"
C=$(code admin2 -X POST $BASE/api/messages/$T1MSG/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 404 ] && ok "مدیر مدرسه دیگر سنجاق نمی‌تواند (404)" || bad "سنجاق مدیر دیگر ($C)"

say "سنجاق — دریافت از سرور (فیلد pinned)"
C=$(code s1 $BASE/api/chats/group/$GMATH7/messages)
[ "$C" = 200 ] && [ "$(json "len(d['pinned'])")" = "2" ] && ok "GET پیام‌ها: فهرست pinned با ۲ سنجاق" || bad "pinned GET ($C, n=$(json "len(d['pinned'])"))"
[ "$(json "any(m['id']=='$T1MSG' for m in d['pinned'])")" = "True" ] && ok "پیام سنجاق‌شده معلم در pinned" || bad "پیام معلم در pinned نیست"
[ "$(json "any(m['pinnedAt'] for m in d['messages'])")" = "True" ] && ok "پیام داخل صفحه هم pinnedAt دارد" || bad "pinnedAt در پیام‌ها نیست"

say "برداشتن سنجاق"
C=$(code t1 -X POST $BASE/api/messages/$T1MSG/pin -H 'content-type: application/json' -d '{"pinned":false}')
[ "$C" = 200 ] && [ "$(json "d['message']['pinnedAt']")" = "None" ] && ok "معلم سنجاق را برداشت" || bad "برداشتن سنجاق ($C)"
C=$(code admin1 -X POST $BASE/api/messages/$S1MSG/pin -H 'content-type: application/json' -d '{"pinned":false}')
[ "$C" = 200 ] && ok "مدیر سنجاق پیام دانش‌آموز را برداشت" || bad "برداشتن مدیر ($C)"
C=$(code s1 $BASE/api/chats/group/$GMATH7/messages)
[ "$(json "len(d['pinned'])")" = "0" ] && ok "pinned اکنون خالی است" || bad "pinned هنوز پر است"

say "سنجاق — DM"
C=$(code t1 -X POST $BASE/api/messages/$T1DM/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 200 ] && ok "معلم پیام خصوصی خودش را سنجاق کرد" || bad "سنجاق DM معلم ($C): $(cat /tmp/dma-out.json)"
C=$(code s1 -X POST $BASE/api/messages/$T1DM/pin -H 'content-type: application/json' -d '{"pinned":false}')
[ "$C" = 403 ] && ok "دانش‌آموز برداشتن سنجاق DM معلم را نمی‌تواند (403)" || bad "s1 برداشتن سنجاق DM ($C)"
C=$(code s1 $BASE/api/chats/dm/$T1ID/messages)
[ "$(json "len(d['pinned'])")" = "1" ] && ok "دانش‌آموز سنجاق DM را در pinned می‌بیند (نمایش برای همه)" || bad "s1 pinned DM ($C)"

say "سنجاق — حالت‌های خطا"
C=$(code t1 -X POST $BASE/api/messages/nonexistent-xyz/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 404 ] && ok "پیام ناموجود → 404" || bad "پیام ناموجود ($C)"
C=$(code t1 -X DELETE $BASE/api/messages/$T1DM > /dev/null; curl -s -b $J/t1.jar -o /tmp/dma-out.json -w "%{http_code}" -X POST $BASE/api/messages/$T1DM/pin -H 'content-type: application/json' -d '{"pinned":true}')
[ "$C" = 400 ] && ok "پیام حذف‌شده قابل سنجاق نیست (400)" || bad "سنجاق پیام حذف‌شده ($C)"

say "هدایت — گروه به گروه"
C=$(code t2 -X POST $BASE/api/messages/$T2MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI8\"}]}")
[ "$C" = 200 ] && [ "$(json "d['results'][0]['ok']")" = "True" ] && ok "معلم t2 پیام علوم را به علوم هشتم هدایت کرد" || bad "هدایت گروه→گروه ($C): $(cat /tmp/dma-out.json)"
C=$(code s5 $BASE/api/chats/group/$GSCI8/messages)
FW=$(json "[m for m in d['messages'] if m.get('isForwarded') and m.get('clientId')=='fwd:$T2MSG:GROUP:$GSCI8']")
[ "$(json "len($FW)")" = "1" ] && ok "پیام هدایت‌شده در مقصد با برچسب درست ثبت شد" || bad "پیام هدایت‌شده در مقصد نیست"
[ "$(json "$FW[0]['forwardedFromName']")" = "سارا مرادی" ] && ok "forwardedFromName = نام فرستنده اصلی (t2)" || bad "forwardedFromName: $(json "$FW[0]['forwardedFromName']")"
[ "$(json "$FW[0]['body']")" = "پیام علوم برای هدایت $TS" ] && ok "متن پیام هدایت‌شده یکسان است" || bad "متن هدایت"
C=$(code s1 $BASE/api/chats/group/$GSCI7/messages)
[ "$(json "len(d['pinned'])")" = "0" ] && ok "پیام هدایت‌شده سنجاق نیست (جداست از مبدأ)" || bad "سنجاق در مقصد"

say "هدایت — dedupe و چندمقصدی"
C=$(code t2 -X POST $BASE/api/messages/$T2MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI8\"}]}")
[ "$C" = 200 ] && ok "هدایت تکراری همان مقصد → ok" || bad "هدایت تکراری ($C)"
C=$(code s5 $BASE/api/chats/group/$GSCI8/messages)
N=$(json "len([m for m in d['messages'] if m.get('clientId')=='fwd:$T2MSG:GROUP:$GSCI8'])")
[ "$N" = "1" ] && ok "هدایت تکراری نسخه جدید نساخت (dedupe)" || bad "dedupe ($N)"
C=$(code t2 -X POST $BASE/api/messages/$T2MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI8\"},{\"kind\":\"GROUP\",\"id\":\"$GMATH7\"},{\"kind\":\"GROUP\",\"id\":\"$GLIT9\"}]}")
OKN=$(json "len([r for r in d['results'] if r['ok']])"); BADN=$(json "len([r for r in d['results'] if not r['ok']])")
[ "$C" = 200 ] && [ "$OKN" = "1" ] && [ "$BADN" = "2" ] && ok "چندمقصدی: ۱ موفق + ۲ ناموفق (عدم انتساب/مدرسه دیگر)" || bad "چندمقصدی ($C, ok=$OKN, bad=$BADN)"
ERR=$(json "[r['error'] for r in d['results'] if not r['ok']][0]")
[ -n "$ERR" ] && ok "دلیل ناموفق گزارش شد: $ERR" || bad "بدون دلیل خطا"
C=$(code t1 -X POST $BASE/api/messages/$T1MSG/forward -H 'content-type: application/json' -d '{"targets":[]}')
[ "$C" = 400 ] && ok "بدون مقصد → 400" || bad "بدون مقصد ($C)"
C=$(code t1 -X POST $BASE/api/messages/nonexistent-xyz/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI7\"}]}")
[ "$C" = 404 ] && ok "هدایت پیام ناموجود → 404" || bad "هدایت ناموجود ($C)"

say "هدایت — ماتریس دسترسی"
C=$(code s1 -X POST $BASE/api/messages/$S1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GMATH8\"}]}")
C=$(code s1 -X POST $BASE/api/messages/$S1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GLIT9\"}]}")
[ "$C" = 200 ] && [ "$(json "d['results'][0]['ok']")" = "False" ] && ok "دانش‌آموز به گروه مدرسه دیگر هدایت نمی‌کند" || bad "هدایت بین‌مدرسه دانش‌آموز ($C)"
C=$(code t4 -X POST $BASE/api/messages/$T1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GLIT9\"}]}")
[ "$C" = 404 ] && ok "معلم مدرسه ۲ به پیام مدرسه ۱ دسترسی ندارد (404)" || bad "مبدأ بین‌مدرسه ($C)"
C=$(code s1 -X POST $BASE/api/messages/$S1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI7\"}]}")
[ "$C" = 200 ] && [ "$(json "d['results'][0]['ok']")" = "True" ] && ok "دانش‌آموز عضو به گروه دیگر کلاس خودش هدایت کرد (علوم)" || bad "هدایت دانش‌آموز هم‌کلاس ($C): $(cat /tmp/dma-out.json)"

say "هدایت — به DM"
C=$(code t1 -X POST $BASE/api/messages/$T1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"DIRECT\",\"id\":\"$S1ID\"}]}")
[ "$C" = 200 ] && [ "$(json "d['results'][0]['ok']")" = "True" ] && ok "معلم پیام گروهی را به DM دانش‌آموز هدایت کرد" || bad "هدایت به DM ($C): $(cat /tmp/dma-out.json)"
C=$(code s1 $BASE/api/chats/dm/$T1ID/messages)
[ "$(json "any(m.get('isForwarded') and m.get('clientId')=='fwd:$T1MSG:DIRECT:$S1ID' for m in d['messages'])")" = "True" ] && ok "پیام هدایت‌شده در DM دریافت شد" || bad "هدایت در DM نیست"
C=$(code s1 -X POST $BASE/api/messages/$S1MSG/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"DIRECT\",\"id\":\"$S5ID\"}]}")
[ "$C" = 200 ] && [ "$(json "d['results'][0]['ok']")" = "False" ] && ok "هدایت به DM هم‌کلاسیِ غیرمجاز (s5 در گروه دیگری است) رد شد: $(json "d['results'][0]['error']")" || bad "ماتریس DM در هدایت ($C)"

say "هدایت — پیام‌های سیستمی"
C=$(code s1 $BASE/api/chats/group/$GMATH7/messages)
ANN=$(json "[m['id'] for m in d['messages'] if m['type'] in ('ANNOUNCEMENT','ASSIGNMENT','LIVE_INVITE','SAMPLEQ')]")
if [ "$(json "len($ANN)")" -gt 0 ]; then
  AID=$(json "$ANN[0]")
  C=$(code admin1 -X POST $BASE/api/messages/$AID/forward -H 'content-type: application/json' -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GSCI7\"}]}")
  [ "$C" = 400 ] && ok "هدایت پیام سیستمی ($(json "d['error']"))" || bad "هدایت پیام سیستمی ($C)"
else
  ok "(پیام سیستمی در گروه نیست — رد شد)"
fi

say "سریال‌سازی فیلدهای جدید در همه جا"
C=$(code s1 $BASE/api/chats/group/$GMATH7/messages)
[ "$(json "all(('isForwarded' in m and 'pinnedAt' in m) for m in d['messages'][:5])")" = "True" ] && ok "isForwarded/pinnedAt در پاسخ گروه" || bad "فیلدهای جدید گروه"
C=$(code s1 $BASE/api/chats/dm/$T1ID/messages)
[ "$(json "all(('isForwarded' in m and 'pinnedAt' in m) for m in d['messages'][:5])")" = "True" ] && ok "isForwarded/pinnedAt در پاسخ DM" || bad "فیلدهای جدید DM"

echo -e "\n════════════════════════════"
echo "نتیجه: $PASS پاس | $FAIL خطا"
[ "$FAIL" = 0 ] && echo "✔ همه تست‌ها پاس شدند" || echo "✘ شکست"
exit $FAIL
