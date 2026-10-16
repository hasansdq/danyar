#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست جامع تکالیف دانیار (مرحله ۴) — ایجاد تکلیف گروه درسی،
# ارسال پاسخ، قوانین اصلاح، دیرهنگام، بازخورد و نمره،
# اعلان‌ها، سرو فایل، جداسازی مدرسه‌ای و گیت امکانات
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
PASS=0; FAIL=0
J=/tmp/danyar-assignments
TS=$RANDOM$RANDOM
mkdir -p $J

say()  { echo -e "\n\033[36m▶ $1\033[0m"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar [$4=realm: app|superadmin]
  local realm="${4:-app}"
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"$realm\"}" > /dev/null
}
code() { curl -s -b $J/$1.jar -o $J/out.json -w "%{http_code}" "${@:2}"; }
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
tomorrow() { date -d "+1 day" +%Y-%m-%dT%H:%M 2>/dev/null || date -v+1d +%Y-%m-%dT%H:%M; }
yesterday() { date -d "-1 day" +%Y-%m-%dT%H:%M 2>/dev/null || date -v-1d +%Y-%m-%dT%H:%M; }

echo "printf" > /dev/null
say "ورود کاربران"
login superadmin Admin@1234 sa superadmin && ok "superadmin"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱"
login beheshti.t1 Pass@123 t1 && ok "معلم ریاضی t1"
login beheshti.t2 Pass@123 t2 && ok "معلم علوم t2"
login beheshti.s1 Pass@123 s1 && ok "دانش‌آموز s1"
login beheshti.s2 Pass@123 s2 && ok "دانش‌آموز s2"
login beheshti.s3 Pass@123 s3 && ok "دانش‌آموز s3"
login beheshti.s5 Pass@123 s5 && ok "دانش‌آموز s5 (کلاس هشتم)"
login farzanegan.t1 Pass@123 ft1 && ok "معلم مدرسه ۲"
login farzanegan.s1 Pass@123 fs1 && ok "دانش‌آموز مدرسه ۲"

say "شناسایی گروه‌های درسی"
code t1 $BASE/api/chats > /dev/null
GMATH7=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هفتم۱'][0]")
GMATH8=$(json "[c['id'] for c in d['conversations'] if c['title']=='ریاضی هشتم۱'][0]")
code t2 $BASE/api/chats > /dev/null
GSCI7=$(json "[c['id'] for c in d['conversations'] if c['title']=='علوم هفتم۱'][0]")
code ft1 $BASE/api/chats > /dev/null
FGROUP=$(json "[c['id'] for c in d['conversations'] if c['type']=='GROUP'][0]")
echo "  math7=$GMATH7 sci7=$GSCI7 math8=$GMATH8 school2=$FGROUP"

DUE_TOMORROW="$(tomorrow)"
DUE_YESTERDAY="$(yesterday)"

say "ایجاد تکلیف (فقط معلم منتسب؛ تکلیف همیشه به گروه درسی)"
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"تمرین فصل کسرها\",\"description\":\"تمرین‌های ۱ تا ۱۰\",\"answerMode\":\"BOTH\",\"allowEdit\":true,\"maxGrade\":20,\"dueAt\":\"$DUE_TOMORROW\"}")
[ "$C" = 201 ] && ok "معلم تکلیف در گروه ریاضی ایجاد کرد (201)" || bad "ایجاد تکلیف ($C): $(cat $J/out.json)"
A1=$(json "d['id']")
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"\",\"title\":\"بی‌گروه\"}")
[ "$C" = 400 ] && ok "تکلیف بدون گروه درسی رد شد (400)" || bad "تکلیف بدون گروه ($C)"
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GSCI7\",\"title\":\"نفوذ\"}")
[ "$C" = 403 ] && ok "t1 به گروه علوم اختصاص ندارد (403)" || bad "ایجاد در گروه غیرمنتسب ($C)"
C=$(code t2 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"نفوذ معلم دیگر\"}")
[ "$C" = 403 ] && ok "t2 به گروه ریاضی t1 اختصاص ندارد (403)" || bad "ایجاد معلم دیگر ($C)"
C=$(code s1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"دانش‌آموز\"}")
[ "$C" = 403 ] && ok "دانش‌آموز نمی‌تواند تکلیف بسازد (403)" || bad "ایجاد توسط دانش‌آموز ($C)"
C=$(code admin1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"مدیر\"}")
[ "$C" = 403 ] && ok "مدیر مدرسه هم نمی‌سازد (403)" || bad "ایجاد توسط مدیر ($C)"
C=$(code ft1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"بین مدرسه\"}")
[ "$C" = 404 ] && ok "معلم مدرسه ۲ به گروه مدرسه ۱ دسترسی ندارد (404)" || bad "ایجاد بین‌مدرسه ($C)"

say "اعلان تکلیف جدید"
C=$(code s1 $BASE/api/notifications)
HIT=$(json "any('تمرین فصل کسرها' in i['title'] and i['type']=='ASSIGNMENT_NEW' for i in d['items'])")
[ "$C" = 200 ] && [ "$HIT" = "True" ] && ok "اعلان تکلیف برای s1 رسیده" || bad "اعلان s1 ($C,$HIT)"
C=$(code s2 $BASE/api/notifications)
HIT=$(json "any('تمرین فصل کسرها' in i['title'] for i in d['items'])")
[ "$HIT" = "True" ] && ok "اعلان برای s2 هم رسیده" || bad "اعلان s2 ($HIT)"
C=$(code s5 $BASE/api/notifications)
HIT=$(json "any('تمرین فصل کسرها' in i['title'] for i in d['items'])")
[ "$HIT" = "False" ] && ok "اعلان به کلاس دیگر (s5) نشتی نکرده" || bad "نشتی اعلان به s5"

say "فهرست تکالیف بر اساس نقش"
C=$(code t1 $BASE/api/assignments)
TOT=$(json "[a['stats']['total'] for a in d['assignments'] if a['id']=='$A1'][0]")
[ "$C" = 200 ] && [ "$TOT" = 4 ] && ok "t1: آمار کل ۴ دانش‌آموز عضو گروه" || bad "آمار t1 ($C,$TOT)"
C=$(code s1 $BASE/api/assignments)
MYST=$(json "[a['myStatus'] for a in d['assignments'] if a['id']=='$A1'][0]")
[ "$MYST" = "NOT_SUBMITTED" ] && ok "s1: تکلیف در فهرست با وضعیت ارسال‌نشده" || bad "وضعیت s1 ($MYST)"
C=$(code s5 $BASE/api/assignments)
HIT=$(json "any(a['id']=='$A1' for a in d['assignments'])")
[ "$HIT" = "False" ] && ok "s5 (کلاس هشتم) تکلیف را نمی‌بیند" || bad "نشتی فهرست به s5"
C=$(code fs1 $BASE/api/assignments)
HIT=$(json "any(a['id']=='$A1' for a in d['assignments'])")
[ "$HIT" = "False" ] && ok "دانش‌آموز مدرسه ۲ تکلیف را نمی‌بیند" || bad "نشتی بین‌مدرسه فهرست"
C=$(code admin1 $BASE/api/assignments)
HIT=$(json "any(a['id']=='$A1' for a in d['assignments'])")
[ "$HIT" = "True" ] && ok "مدیر مدرسه تکلیف مدرسه خودش را می‌بیند" || bad "دسترسی مدیر ($HIT)"
C=$(code s1 "$BASE/api/assignments/$A1/submissions")
[ "$C" = 403 ] && ok "دانش‌آموز فهرست پاسخ‌ها را نمی‌بیند (403)" || bad "دسترسی رستر به دانش‌آموز ($C)"
C=$(curl -s -o $J/out.json -w "%{http_code}" $BASE/api/assignments)
[ "$C" = 401 ] && ok "مهمان 401" || bad "مهمان ($C)"

say "جزئیات تکلیف و کنترل دسترسی"
C=$(code s1 $BASE/api/assignments/$A1)
[ "$C" = 200 ] && ok "s1 جزئیات را می‌بیند" || bad "جزئیات s1 ($C)"
C=$(code s5 $BASE/api/assignments/$A1)
[ "$C" = 404 ] && ok "s5 جزئیات 404" || bad "جزئیات s5 ($C)"
C=$(code fs1 $BASE/api/assignments/$A1)
[ "$C" = 404 ] && ok "دانش‌آموز مدرسه ۲ جزئیات 404 (جداسازی)" || bad "جزئیات بین‌مدرسه ($C)"
C=$(code ft1 $BASE/api/assignments/$A1)
[ "$C" = 404 ] && ok "معلم مدرسه ۲ جزئیات 404" || bad "جزئیات معلم مدرسه ۲ ($C)"
C=$(code admin1 $BASE/api/assignments/$A1)
ACC=$(json "d['access']")
[ "$C" = 200 ] && [ "$ACC" = "VIEW" ] && ok "مدیر مدرسه دسترسی VIEW" || bad "دسترسی مدیر ($C,$ACC)"
C=$(code t1 $BASE/api/assignments/$A1)
ACC=$(json "d['access']")
[ "$ACC" = "MANAGE" ] && ok "معلم منتسب دسترسی MANAGE" || bad "دسترسی معلم ($ACC)"

say "ارسال پاسخ دانش‌آموز و قوانین نحوه ارسال"
C=$(code s1 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"پاسخ من: تمرین‌ها حل شد"}')
[ "$C" = 201 ] && ok "s1 پاسخ متنی ثبت کرد (201)" || bad "ثبت پاسخ s1 ($C): $(cat $J/out.json)"
ST=$(json "d['submission']['status']")
[ "$ST" = "SUBMITTED" ] && ok "وضعیت اولیه: ارسال‌شده" || bad "وضعیت پاسخ s1 ($ST)"
C=$(code s1 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"پاسخ اصلاح‌شده"}')
[ "$C" = 200 ] && ok "s1 پاسخ را اصلاح کرد (allowEdit)" || bad "اصلاح پاسخ s1 ($C)"
ED=$(json "d['submission']['editedAt']")
[ "$ED" != "None" ] && ok "زمان ویرایش ثبت شد" || bad "editedAt ثبت نشد"
C=$(code s5 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"نفوذ"}')
[ "$C" = 404 ] && ok "s5 به تکلیف گروه خودش نیست 404" || bad "ارسال s5 ($C)"
C=$(code fs1 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"نفوذ"}')
[ "$C" = 404 ] && ok "دانش‌آموز مدرسه ۲ ارسال 404" || bad "ارسال بین‌مدرسه ($C)"
C=$(code ft1 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"معلم"}')
[ "$C" = 403 ] && ok "معلم نمی‌تواند پاسخ بفرستد (403)" || bad "ارسال توسط معلم ($C)"

# تکلیف فقط متنی (t2)
C=$(code t2 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GSCI7\",\"title\":\"گزارش آزمایش\",\"answerMode\":\"TEXT\",\"allowEdit\":true}")
A_TEXT=$(json "d['id']")
C=$(code s2 -X PUT $BASE/api/assignments/$A_TEXT/submission -H 'content-type: application/json' -d '{"text":"گزارش من"}')
[ "$C" = 201 ] && ok "ارسال متنی در تکلیف TEXT (201)" || bad "TEXT صحیح ($C)"
# فایل برای تکلیف متنی → باید رد شود
echo "test file content" > $J/att.txt
C=$(curl -s -b $J/t2.jar -o $J/up.json -w "%{http_code}" -X POST $BASE/api/uploads -F "file=@$J/att.txt" -F "purpose=assignment")
UPKEY=$(python3 -c "import json;print(json.load(open('$J/up.json'))['key'])" 2>/dev/null)
C=$(code s2 -X PUT $BASE/api/assignments/$A_TEXT/submission -H 'content-type: application/json' -d "{\"text\":\"گزارش\",\"attachment\":{\"key\":\"$UPKEY\"}}")
[ "$C" = 400 ] && ok "فایل در تکلیف متنی رد شد (400)" || bad "فایل در TEXT ($C)"

# تکلیف فقط فایلی
C=$(code t2 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GSCI7\",\"title\":\"عکس دفتر\",\"answerMode\":\"FILE\",\"allowEdit\":true}")
A_FILE=$(json "d['id']")
C=$(code s2 -X PUT $BASE/api/assignments/$A_FILE/submission -H 'content-type: application/json' -d '{"text":"فقط متن"}')
[ "$C" = 400 ] && ok "متن در تکلیف فایلی رد شد (400)" || bad "متن در FILE ($C)"
C=$(code s2 -X PUT $BASE/api/assignments/$A_FILE/submission -H 'content-type: application/json' -d '{}')
[ "$C" = 400 ] && ok "پاسخ خالی رد شد (400)" || bad "خالی در FILE ($C)"
echo "pdf-ish content for homework" > $J/hw.txt
C=$(curl -s -b $J/s2.jar -o $J/up2.json -w "%{http_code}" -X POST $BASE/api/uploads -F "file=@$J/hw.txt" -F "purpose=assignment")
[ "$C" = 201 ] && ok "آپلود فایل پاسخ با purpose=assignment (201)" || bad "آپلود purpose=assignment ($C): $(cat $J/up2.json)"
UPKEY2=$(python3 -c "import json;print(json.load(open('$J/up2.json'))['key'])")
C=$(code s2 -X PUT $BASE/api/assignments/$A_FILE/submission -H 'content-type: application/json' -d "{\"text\":\"\",\"attachment\":{\"key\":\"$UPKEY2\"}}")
[ "$C" = 201 ] && ok "ارسال فایلی در تکلیف FILE (201)" || bad "FILE صحیح ($C): $(cat $J/out.json)"

say "قانون اصلاح‌ناپذیری (allowEdit=false)"
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"جمع‌بندی نهایی\",\"answerMode\":\"TEXT\",\"allowEdit\":false}")
A_NOEDIT=$(json "d['id']")
C=$(code s1 -X PUT $BASE/api/assignments/$A_NOEDIT/submission -H 'content-type: application/json' -d '{"text":"پاسخ یک‌باره"}')
[ "$C" = 201 ] && ok "ارسال اول در تکلیف بدون اصلاح (201)" || bad "ارسال اول NOEDIT ($C)"
C=$(code s1 -X PUT $BASE/api/assignments/$A_NOEDIT/submission -H 'content-type: application/json' -d '{"text":"تلاش برای اصلاح"}')
[ "$C" = 403 ] && ok "اصلاح پاسخ رد شد (403)" || bad "اصلاح در NOEDIT ($C)"

say "پاسخ دیرهنگام"
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"تکلیف دیروز\",\"answerMode\":\"TEXT\",\"allowEdit\":true,\"dueAt\":\"$DUE_YESTERDAY\"}")
A_LATE=$(json "d['id']")
C=$(code s2 -X PUT $BASE/api/assignments/$A_LATE/submission -H 'content-type: application/json' -d '{"text":"پاسخ با تأخیر"}')
[ "$C" = 201 ] && ok "ارسال پس از مهلت پذیرفته شد" || bad "ارسال دیرهنگام ($C)"
ST=$(json "d['submission']['status']")
[ "$ST" = "LATE" ] && ok "وضعیت: دیرهنگام" || bad "وضعیت دیرهنگام ($ST)"

say "بازخورد و نمره معلم"
SID_S1=$(code t1 $BASE/api/assignments/$A1/submissions > /dev/null; json "[r['studentId'] for r in d['roster'] if r['fullName']=='رضا احمدی'][0]")
C=$(code t1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"APPROVED\",\"grade\":18,\"note\":\"آفرین\"}")
[ "$C" = 200 ] && ok "بازخورد تایید‌شده + نمره ۱۸ ثبت شد" || bad "ثبت بازخورد ($C): $(cat $J/out.json)"
RV=$(json "d['submission']['reviewedAt']")
[ "$RV" != "None" ] && ok "تکلیف بررسی‌شده شد" || bad "reviewedAt خالی"
C=$(code t1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"APPROVED\",\"grade\":25}")
[ "$C" = 400 ] && ok "نمره بیشتر از بیشینه رد شد (400)" || bad "نمره خارج بازه ($C)"
C=$(code t1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"INCOMPLETE\",\"grade\":8,\"note\":\"ناقص است\"}")
[ "$C" = 200 ] && ok "بازخورد ناقص ثبت شد" || bad "بازخورد ناقص ($C)"
C=$(code s1 -X PUT $BASE/api/assignments/$A1/submission -H 'content-type: application/json' -d '{"text":"تلاش برای تغییر پس از بررسی"}')
[ "$C" = 403 ] && ok "اصلاح پاسخ پس از بررسی ممنوع (403)" || bad "اصلاح پس از بررسی ($C)"
C=$(code t2 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"APPROVED\"}")
[ "$C" = 404 ] && ok "معلم غیرمنتسب بازخورد نمی‌گذارد (404)" || bad "بازخورد معلم دیگر ($C)"
C=$(code s1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"APPROVED\"}")
[ "$C" = 403 ] && ok "دانش‌آموز بازخورد نمی‌گذارد (403)" || bad "بازخورد دانش‌آموز ($C)"
C=$(code ft1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S1\",\"feedbackStatus\":\"APPROVED\"}")
[ "$C" = 404 ] && ok "معلم مدرسه ۲ بازخورد 404" || bad "بازخورد بین‌مدرسه ($C)"
SID_S3=$(code t1 $BASE/api/assignments/$A1/submissions > /dev/null; json "[r['studentId'] for r in d['roster'] if r['fullName']=='سینا جعفری'][0]")
C=$(code t1 -X POST $BASE/api/assignments/$A1/feedback -H 'content-type: application/json' -d "{\"studentId\":\"$SID_S3\",\"feedbackStatus\":\"APPROVED\"}")
[ "$C" = 400 ] && ok "بازخورد برای پاسخ ارسال‌نشده رد شد (400)" || bad "بازخورد بدون پاسخ ($C)"

say "مشاهده بازخورد و نمره توسط دانش‌آموز (فقط خودش)"
C=$(code s1 $BASE/api/assignments/$A1)
MY=$(json "(d['mySubmission']['status'], d['mySubmission']['feedbackStatus'], d['mySubmission']['grade'])")
echo "   s1 → $MY"
[ "$(json "d['mySubmission']['status']")" = "REVIEWED" ] && [ "$(json "d['mySubmission']['grade']")" = 8 ] && ok "s1 وضعیت بررسی‌شده + نمره ۸ می‌بیند" || bad "نمای s1 ($(cat $J/out.json | head -c 150))"
C=$(code s2 $BASE/api/assignments/$A1)
MS=$(json "d['mySubmission']")
[ "$MS" = "None" ] && ok "s2 پاسخ s1 را نمی‌بیند (فقط پاسخ خودش)" || bad "نشتی پاسخ s1 به s2"

say "اعلان ثبت بازخورد"
C=$(code s1 $BASE/api/notifications)
HIT=$(json "any(i['type']=='FEEDBACK_POSTED' for i in d['items'])")
[ "$HIT" = "True" ] && ok "اعلان بازخورد برای s1 رسیده" || bad "اعلان بازخورد s1 ($HIT)"
C=$(code s2 $BASE/api/notifications)
HIT=$(json "any(i['type']=='FEEDBACK_POSTED' for i in d['items'])")
[ "$HIT" = "False" ] && ok "اعلان بازخورد s1 به s2 نشتی نکرده" || bad "نشتی اعلان بازخورد"

say "فهرست ارسال‌شده / ارسال‌نشده / دیرهنگام (رستر معلم و مدیر)"
C=$(code t1 $BASE/api/assignments/$A_LATE/submissions)
[ "$C" = 200 ] && ok "رستر معلم 200" || bad "رستر معلم ($C)"
LATE_OK=$(json "any(r['submission'] and r['submission']['status']=='LATE' for r in d['roster'])")
[ "$LATE_OK" = "True" ] && ok "پاسخ دیرهنگام در رستر مشخص است" || bad "دیرهنگام در رستر ($LATE_OK)"
C=$(code admin1 $BASE/api/assignments/$A_LATE/submissions)
[ "$C" = 200 ] && ok "مدیر مدرسه رستر را می‌بیند (دسترسی آموزشی)" || bad "رستر مدیر ($C)"
C=$(code fs1 $BASE/api/assignments/$A_LATE/submissions)
[ "$C" = 404 ] && ok "دانش‌آموز مدرسه ۲ رستر 404" || bad "رستر بین‌مدرسه ($C)"

say "ویرایش تکلیف"
C=$(code t1 -X PATCH $BASE/api/assignments/$A_LATE -H 'content-type: application/json' -d '{"title":"تکلیف دیروز (اصلاح‌شده)"}')
[ "$C" = 200 ] && ok "معلم تکلیف را ویرایش کرد" || bad "ویرایش تکلیف ($C)"
C=$(code t1 -X PATCH $BASE/api/assignments/$A_LATE -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH8\"}")
[ "$C" = 400 ] && ok "تغییر گروه درسی تکلیف ممنوع (400)" || bad "تغییر گروه ($C)"
C=$(code t2 -X PATCH $BASE/api/assignments/$A_LATE -H 'content-type: application/json' -d '{"title":"هک"}')
[ "$C" = 404 ] && ok "معلم غیرمنتسب ویرایش نمی‌کند (404)" || bad "ویرایش معلم دیگر ($C)"
C=$(code t1 $BASE/api/assignments/$A_LATE)
NEWTITLE=$(json "d['assignment']['title']")
[ "$NEWTITLE" = "تکلیف دیروز (اصلاح‌شده)" ] && ok "عنوان ویرایش‌شده در جزئیات" || bad "عنوان جدید ($NEWTITLE)"

say "سرو فایل پیوست و فایل پاسخ"
# پیوست تکلیف
echo "worksheet content for math" > $J/sheet.txt
C=$(curl -s -b $J/t1.jar -o $J/up3.json -w "%{http_code}" -X POST $BASE/api/uploads -F "file=@$J/sheet.txt" -F "purpose=assignment")
UPKEY3=$(python3 -c "import json;print(json.load(open('$J/up3.json'))['key'])")
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"کاربرگ کسر\",\"answerMode\":\"BOTH\",\"allowEdit\":true,\"attachment\":{\"key\":\"$UPKEY3\"}}")
A_ATT=$(json "d['id']")
C=$(code s1 $BASE/api/assignments/$A_ATT/attachment)
[ "$C" = 200 ] && ok "دانش‌آموز گروه پیوست تکلیف را دانلود کرد" || bad "دانلود پیوست s1 ($C)"
C=$(code s5 $BASE/api/assignments/$A_ATT/attachment)
[ "$C" = 404 ] && ok "s5 پیوست تکلیف 404" || bad "پیوست s5 ($C)"
C=$(code fs1 $BASE/api/assignments/$A_ATT/attachment)
[ "$C" = 404 ] && ok "مدرسه ۲ پیوست 404" || bad "پیوست بین‌مدرسه ($C)"
C=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/assignments/$A_ATT/attachment)
[ "$C" = 401 ] && ok "مهمان پیوست 401" || bad "پیوست مهمان ($C)"
# فایل پاسخ
SID_S2=$(code t1 $BASE/api/assignments/$A_FILE/submissions > /dev/null; json "[r['studentId'] for r in d['roster'] if r['fullName']=='مینا نظری'][0]")
SUBID=$(code s2 $BASE/api/assignments/$A_FILE > /dev/null; json "d['mySubmission']['id']")
C=$(code s2 $BASE/api/submissions/$SUBID/file)
[ "$C" = 200 ] && ok "s2 فایل پاسخ خودش را دانلود کرد" || bad "دانلود فایل پاسخ خود ($C)"
C=$(code s1 $BASE/api/submissions/$SUBID/file)
[ "$C" = 403 ] && ok "s1 فایل پاسخ s2 را نمی‌بیند (403)" || bad "فایل پاسخ دیگری ($C)"
C=$(code t2 $BASE/api/submissions/$SUBID/file)
[ "$C" = 200 ] && ok "معلم همان گروه فایل پاسخ را دانلود کرد" || bad "فایل پاسخ معلم ($C)"
C=$(code admin1 $BASE/api/submissions/$SUBID/file)
[ "$C" = 200 ] && ok "مدیر مدرسه فایل پاسخ را دانلود کرد" || bad "فایل پاسخ مدیر ($C)"
C=$(code ft1 $BASE/api/submissions/$SUBID/file)
[ "$C" = 403 ] && ok "معلم مدرسه ۲ فایل پاسخ 403" || bad "فایل پاسخ بین‌مدرسه ($C)"

say "علامت‌گذاری اعلان‌ها"
C=$(code s1 -X POST $BASE/api/notifications/read -H 'content-type: application/json' -d '{"all":true}')
N=$(json "d['unreadCount']")
[ "$C" = 200 ] && [ "$N" = 0 ] && ok "همه اعلان‌های s1 خوانده شد (باقی: ۰)" || bad "خواندن اعلان‌ها ($C,$N)"

say "حذف تکلیف (دو مرحله‌ای در صورت وجود پاسخ)"
C=$(code t1 -X DELETE $BASE/api/assignments/$A_NOEDIT)
[ "$C" = 409 ] && ok "حذف بدون confirm با پاسخ ثبت‌شده 409" || bad "حذف مرحله ۱ ($C)"
C=$(code t1 -X DELETE "$BASE/api/assignments/$A_NOEDIT?confirm=true")
[ "$C" = 200 ] && ok "حذف با confirm انجام شد" || bad "حذف مرحله ۲ ($C)"
C=$(code s1 $BASE/api/assignments/$A_NOEDIT)
[ "$C" = 404 ] && ok "تکلیف حذف‌شده 404" || bad "تکلیف حذف‌شده ($C)"
C=$(code t1 -X DELETE $BASE/api/assignments/$A_ATT)
[ "$C" = 200 ] && ok "حذف تکلیف بی‌پاسخ بلافاصله" || bad "حذف بی‌پاسخ ($C)"
C=$(code t2 -X DELETE $BASE/api/assignments/$A1)
[ "$C" = 404 ] && ok "معلم غیرمنتسب حذف نمی‌کند (404)" || bad "حذف معلم دیگر ($C)"
C=$(code ft1 -X DELETE $BASE/api/assignments/$A1)
[ "$C" = 404 ] && ok "حذف بین‌مدرسه 404" || bad "حذف بین‌مدرسه ($C)"

say "پیام خودکار تکلیف در گروه + اعلان (به‌روزرسانی و حذف هماهنگ)"
code sa $BASE/api/schools > /dev/null
SCHOOL1=$(json "[s['id'] for s in d['schools'] if 'بهشتی' in s['name']][0]")
# پیام ASSIGNMENT برای تکلیف A1 در گروه ریاضی هفتم۱
code s1 "$BASE/api/chats/group/$GMATH7/messages?limit=50" > /dev/null
ANN=$(json "any(m['type']=='ASSIGNMENT' and m.get('assignmentId')=='$A1' and 'تمرین فصل کسرها' in m['body'] for m in d['messages'])")
[ "$ANN" = "True" ] && ok "پیام تکلیف خودکار در گروه ریاضی منتشر شد" || bad "پیام خودکار گروه ($ANN)"
# ویرایش عنوان تکلیف → متن پیام هم به‌روز شود
C=$(code t1 -X PATCH $BASE/api/assignments/$A1 -H 'content-type: application/json' -d '{"title":"تمرین فصل کسرها (ویرایش)"}')
[ "$C" = 200 ] && ok "عنوان تکلیف ویرایش شد" || bad "ویرایش برای همگام‌سازی ($C)"
code s1 "$BASE/api/chats/group/$GMATH7/messages?limit=50" > /dev/null
ANN2=$(json "any(m['type']=='ASSIGNMENT' and m.get('assignmentId')=='$A1' and 'ویرایش' in m['body'] for m in d['messages'])")
[ "$ANN2" = "True" ] && ok "متن پیام گروه با ویرایش تکلیف همگام شد" || bad "همگام‌سازی متن پیام ($ANN2)"
code t1 -X PATCH $BASE/api/assignments/$A1 -H 'content-type: application/json' -d '{"title":"تمرین فصل کسرها"}' > /dev/null
# تکلیف با پیام → حذف تکلیف → پیام حذف (نرم) شود
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"تکلیف موقت برای حذف\",\"answerMode\":\"TEXT\",\"allowEdit\":true}")
A_DEL=$(json "d['id']")
code s1 "$BASE/api/chats/group/$GMATH7/messages?limit=50" > /dev/null
HASMSG=$(json "any(m['type']=='ASSIGNMENT' and m.get('assignmentId')=='$A_DEL' for m in d['messages'])")
[ "$HASMSG" = "True" ] && ok "پیام تکلیف موقت در گروه منتشر شد" || bad "پیام تکلیف موقت ($HASMSG)"
code t1 -X DELETE "$BASE/api/assignments/$A_DEL?confirm=true" > /dev/null
code s1 "$BASE/api/chats/group/$GMATH7/messages?limit=50" > /dev/null
DELMSG=$(json "[ (m['deletedAt'] is not None) for m in d['messages'] if m['type']=='ASSIGNMENT' and m.get('assignmentId')=='$A_DEL'][0]")
[ "$DELMSG" = "True" ] && ok "با حذف تکلیف، پیام آن در گروه حذف شد" || bad "حذف پیام همگام ($DELMSG)"
# مدرسه با chat خاموش و assignments روشن: تکلیف و اعلان کار می‌کند ولی پیام گروهی ثبت نمی‌شود
code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":false,"dm":true,"assignments":true,"onlineClass":true}}' > /dev/null
C=$(code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"تکلیف بدون چت\",\"answerMode\":\"TEXT\",\"allowEdit\":true}")
[ "$C" = 201 ] && ok "با chat خاموش: تکلیف باز هم ساخته می‌شود" || bad "تکلیف با chat خاموش ($C)"
A_NOCHAT=$(json "d['id']")
# با chat خاموش پیام جدیدی در گروه ثبت نشده (خواندن تاریخچه همچنان آزاد است)
code admin1 "$BASE/api/chats/group/$GMATH7/messages?limit=50" > /dev/null
NOMSG=$(json "any(m['type']=='ASSIGNMENT' and m.get('assignmentId')=='$A_NOCHAT' for m in d['messages'])")
[ "$NOMSG" = "False" ] && ok "با chat خاموش: پیام گروهی برای تکلیف ثبت نشد" || bad "پیام بدون گیت ($NOMSG)"
code s1 $BASE/api/notifications > /dev/null
NOTIF=$(json "any('تکلیف بدون چت' in i['title'] for i in d['items'])")
[ "$NOTIF" = "True" ] && ok "اعلان تکلیف با chat خاموش همچنان ارسال شد" || bad "اعلان بدون چت ($NOTIF)"
code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":true,"dm":true,"assignments":true,"onlineClass":true}}' > /dev/null
code t1 -X DELETE "$BASE/api/assignments/$A_NOCHAT?confirm=true" > /dev/null
C=$(code s1 $BASE/api/assignments)
[ "$C" = 200 ] && ok "امکانات بازگردانده شد" || bad "بازگردانی امکانات ($C)"

say "گیت امکانات مدرسه (features.assignments)"
code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":true,"dm":true,"assignments":false,"onlineClass":true}}' > /dev/null
C=$(code t1 $BASE/api/assignments)
[ "$C" = 403 ] && ok "با امکانات خاموش: فهرست تکالیف 403" || bad "گیت فهرست ($C)"
C=$(curl -s -b $J/t1.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/uploads -F "file=@$J/sheet.txt" -F "purpose=assignment")
[ "$C" = 403 ] && ok "با امکانات خاموش: آپلود تکلیف 403" || bad "گیت آپلود ($C)"
C=$(code s1 $BASE/api/assignments/$A1)
[ "$C" = 403 ] && ok "با امکانات خاموش: جزئیات 403" || bad "گیت جزئیات ($C)"
C=$(curl -s -b $J/t1.jar -o /dev/null -w "%{http_code}" -X POST $BASE/api/uploads -F "file=@$J/sheet.txt")
[ "$C" = 201 ] && ok "آپلود چت (purpose پیش‌فرض) همچنان کار می‌کند" || bad "آپلود چت ($C)"
code sa -X PATCH $BASE/api/schools/$SCHOOL1 -H 'content-type: application/json' -d '{"features":{"chat":true,"dm":true,"assignments":true,"onlineClass":true}}' > /dev/null
C=$(code t1 $BASE/api/assignments)
[ "$C" = 200 ] && ok "امکانات دوباره فعال شد" || bad "بازگردانی امکانات ($C)"

say "پایداری داده پس از همه تست‌ها"
C=$(code s1 $BASE/api/assignments/$A1)
G=$(json "d['mySubmission']['grade']")
[ "$G" = 8 ] && ok "نمره و بازخورد در دیتابیس ماندگار است" || bad "ماندگاری نمره ($G)"

echo -e "\n\033[33m═══ نتیجه: $PASS پاس، $FAIL شکست ═══\033[0m"
[ $FAIL -eq 0 ]
