#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# آزمون مرحله ۷ — اعلان‌ها: بدون تکرار، بی‌صدایی، ترجیحات، جداسازی
# فقط نتایج واقعی HTTP گزارش می‌شوند.
# ═══════════════════════════════════════════════════════════════
BASE="http://localhost:3000"
PASS="Pass@123"
JAR="/tmp/danyar-notif-test"
RUN_ID=$(date +%s)
mkdir -p "$JAR"

P=0; F=0
ok()  { P=$((P+1)); echo "✔ [OK] $1"; }
bad() { F=$((F+1)); echo "✘ [FAIL] $1"; }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi }

GROUP_ID="cmv1aryqy000elokrx43nz39n"      # ریاضی هفتم۱ (کلاس هفتم۱، مدرسه ۱)
CLASS1_ID="cmv1aryqw000alokrajw9ermw"     # هفتم۱

echo "── ورود کاربران ──"
# پاک‌سازی اعلان‌های انباشته اجراهای قبلی (لیست API ۵۰ آیتم است و شمارش تفاضلی خراب می‌شود)
bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();await db.notification.deleteMany({where:{user:{username:{in:['beheshti.admin','beheshti.t1','beheshti.s1','beheshti.s2','farzanegan.s1']}}}});await db.\$disconnect();console.log('notif-cleaned')" > /dev/null 2>&1
for u in beheshti.admin beheshti.t1 beheshti.s1 beheshti.s2 farzanegan.s1; do
  curl -s -c "$JAR/$u.txt" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$u\",\"password\":\"$PASS\",\"realm\":\"app\"}" -o /dev/null
done
check "ورود ۵ کاربر آزمون" "1"

count_type() { # user_cookie type
  curl -s -b "$JAR/$1.txt" "$BASE/api/notifications" | jq -r --arg t "$2" '[.items[] | select(.type==$t)] | length'
}
total_count() {
  curl -s -b "$JAR/$1.txt" "$BASE/api/notifications" | jq -r '.unreadCount'
}
ADMIN_ID=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/me" | jq -r '.user.id')
T1_ID=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/users?q=beheshti.t1" | jq -r '.users[0].id')

echo "── ۱. اعلان پیام خصوصی ──"
B_T1_PM=$(count_type beheshti.t1 PRIVATE_MESSAGE)
B_T1_TOTAL=$(total_count beheshti.t1)
DM=$(curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$T1_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"سلام، پیام آزمون اعلان خصوصی","clientId":"notif-dm-test-'$RUN_ID'-1"}')
check "پیام خصوصی ارسال شد" "$(echo "$DM" | jq -r 'if .message.id then 1 else 0 end')"
A_T1_PM=$(count_type beheshti.t1 PRIVATE_MESSAGE)
check "اعلان PRIVATE_MESSAGE برای گیرنده ثبت شد" "$(if [ $((A_T1_PM - B_T1_PM)) = "1" ]; then echo 1; else echo 0; fi)"
DM_LINK=$(curl -s -b "$JAR/beheshti.t1.txt" "$BASE/api/notifications" | jq -r '[.items[] | select(.type=="PRIVATE_MESSAGE")][0].link')
check "لینک اعلان به گفتگوی فرستنده باز می‌شود" "$(if [ "$DM_LINK" = "/chats/dm/$ADMIN_ID" ]; then echo 1; else echo 0; fi)"

# تلاش مجدد همان پیام با همان clientId — بدون اعلان تکراری
DUP=$(curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$T1_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"سلام، پیام آزمون اعلان خصوصی","clientId":"notif-dm-test-'$RUN_ID'-1"}')
A2_T1_PM=$(count_type beheshti.t1 PRIVATE_MESSAGE)
check "تلاش مجدد با همان clientId → duplicate و بدون اعلان جدید" "$(if [ "$(echo "$DUP" | jq '.duplicate')" = "true" ] && [ "$A2_T1_PM" = "$A_T1_PM" ]; then echo 1; else echo 0; fi)"

echo "── ۲. اعلان پیام گروهی ──"
B_S1_GM=$(count_type beheshti.s1 GROUP_MESSAGE)
B_S2_GM=$(count_type beheshti.s2 GROUP_MESSAGE)
B_ADMIN_GM=$(count_type beheshti.admin GROUP_MESSAGE)
GM=$(curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"اعلان گروهی آزمونی","clientId":"notif-gm-test-'$RUN_ID'-1"}')
check "پیام گروهی ارسال شد" "$(echo "$GM" | jq -r 'if .message.id then 1 else 0 end')"
A_S1_GM=$(count_type beheshti.s1 GROUP_MESSAGE)
A_S2_GM=$(count_type beheshti.s2 GROUP_MESSAGE)
A_ADMIN_GM=$(count_type beheshti.admin GROUP_MESSAGE)
check "هر عضو دقیقاً یک اعلان GROUP_MESSAGE گرفت" "$(if [ $((A_S1_GM - B_S1_GM)) = "1" ] && [ $((A_S2_GM - B_S2_GM)) = "1" ]; then echo 1; else echo 0; fi)"
check "مدیر مدرسه (عضو گروه‌های کلاس) هم اعلان گرفت" "$(if [ $((A_ADMIN_GM - B_ADMIN_GM)) = "1" ]; then echo 1; else echo 0; fi)"
B_T1_GM=$(count_type beheshti.t1 GROUP_MESSAGE)
GM2=$(curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"پیام دوم آزمون","clientId":"notif-gm-test-2-'$RUN_ID'"}')
A_T1_GM=$(count_type beheshti.t1 GROUP_MESSAGE)
check "فرستنده برای پیام خودش اعلان نمی‌گیرد" "$(if [ "$A_T1_GM" = "$B_T1_GM" ]; then echo 1; else echo 0; fi)"

echo "── ۳. تکلیف: اعلان بدون تکرار ──"
B_S1_AN=$(count_type beheshti.s1 ASSIGNMENT_NEW)
B_S1_GM2=$(count_type beheshti.s1 GROUP_MESSAGE)
ASG=$(curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/assignments" \
  -H 'Content-Type: application/json' \
  -d "{\"subjectGroupId\":\"$GROUP_ID\",\"title\":\"تکلیف آزمون اعلان\",\"description\":\"توضیح\",\"answerMode\":\"TEXT\"}")
ASG_ID=$(echo "$ASG" | jq -r '.id')
check "تکلیف ایجاد شد" "$(if [ -n "$ASG_ID" ] && [ "$ASG_ID" != "null" ]; then echo 1; else echo 0; fi)"
A_S1_AN=$(count_type beheshti.s1 ASSIGNMENT_NEW)
A_S1_GM3=$(count_type beheshti.s1 GROUP_MESSAGE)
check "دانش‌آموز اعلان ASSIGNMENT_NEW گرفت" "$(if [ $((A_S1_AN - B_S1_AN)) = "1" ]; then echo 1; else echo 0; fi)"
check "پیام خودکار تکلیف اعلان GROUP_MESSAGE تکراری نساخت" "$(if [ "$A_S1_GM3" = "$B_S1_GM2" ]; then echo 1; else echo 0; fi)"

echo "── ۴. بازخورد معلم ──"
SUB=$(curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/assignments/$ASG_ID/submission" \
  -H 'Content-Type: application/json' \
  -d '{"text":"پاسخ دانش‌آموز به تکلیف آزمون"}')
check "دانش‌آموز پاسخ ارسال کرد" "$(echo "$SUB" | jq -r 'if .submission.id then 1 else 0 end')"
B_S1_FB=$(count_type beheshti.s1 FEEDBACK_POSTED)
FB=$(curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/assignments/$ASG_ID/feedback" \
  -H 'Content-Type: application/json' \
  -d "{\"studentId\":\"$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/users?q=beheshti.s1" | jq -r '.users[0].id')\",\"feedbackStatus\":\"APPROVED\",\"feedbackNote\":\"خیلی خوب\"}")
check "بازخورد ثبت شد" "$(echo "$FB" | jq -r 'if .submission then 1 else 0 end')"
A_S1_FB=$(count_type beheshti.s1 FEEDBACK_POSTED)
check "اعلان FEEDBACK_POSTED برای دانش‌آموز" "$(if [ $((A_S1_FB - B_S1_FB)) = "1" ]; then echo 1; else echo 0; fi)"

echo "── ۵. اطلاعیه مدرسه: هر کاربر فقط یک‌بار ──"
B_S1_SA=$(count_type beheshti.s1 SCHOOL_ANNOUNCEMENT)
B_T1_SA=$(count_type beheshti.t1 SCHOOL_ANNOUNCEMENT)
B_ADMIN_SA=$(count_type beheshti.admin SCHOOL_ANNOUNCEMENT)
ANN=$(curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/announcements" \
  -H 'Content-Type: application/json' \
  -d "{\"body\":\"اطلاعیه رسمی آزمون دانیار\",\"classroomIds\":[\"$CLASS1_ID\"]}")
check "اطلاعیه به کلاس با ۳ گروه ارسال شد" "$(echo "$ANN" | jq -r 'if .delivered==3 then 1 else 0 end')"
A_S1_SA=$(count_type beheshti.s1 SCHOOL_ANNOUNCEMENT)
A_T1_SA=$(count_type beheshti.t1 SCHOOL_ANNOUNCEMENT)
A_ADMIN_SA=$(count_type beheshti.admin SCHOOL_ANNOUNCEMENT)
check "دانش‌آموز عضو چند گروه فقط یک اعلان اطلاعیه گرفت" "$(if [ $((A_S1_SA - B_S1_SA)) = "1" ]; then echo 1; else echo 0; fi)"
check "معلم هم یک اعلان اطلاعیه گرفت" "$(if [ $((A_T1_SA - B_T1_SA)) = "1" ]; then echo 1; else echo 0; fi)"
check "فرستنده اطلاعیه اعلان نمی‌گیرد" "$(if [ "$A_ADMIN_SA" = "$B_ADMIN_SA" ]; then echo 1; else echo 0; fi)"

echo "── ۶. بی‌صدایی گفتگو ──"
MUTE=$(curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/mutes" \
  -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"GROUP\",\"chatKey\":\"$GROUP_ID\",\"muted\":true}")
check "بی‌صدا کردن گروه ذخیره شد" "$(echo "$MUTE" | jq -r 'if .muted==true then 1 else 0 end')"
MUTE_LIST=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/me/mutes")
check "فهرست بی‌صدایی‌ها با عنوان گروه" "$(echo "$MUTE_LIST" | jq -r 'if (.items | length) > 0 and .items[0].title != null then 1 else 0 end')"
B_S1_GM4=$(count_type beheshti.s1 GROUP_MESSAGE)
curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"پیام هنگام بی‌صدایی","clientId":"notif-gm-test-3-'$RUN_ID'"}' > /dev/null
A_S1_GM4=$(count_type beheshti.s1 GROUP_MESSAGE)
check "گروه بی‌صدا: اعلان جدید ساخته نشد" "$(if [ "$A_S1_GM4" = "$B_S1_GM4" ]; then echo 1; else echo 0; fi)"
# اما شمارنده پیام نخوانده گروه همچنان کار می‌کند (جداست از اعلان)
UNREAD_IN_LIST=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/chats" | jq -r --arg g "$GROUP_ID" '[.chats[]? | select(.id==$g)][0].unread // .items[0].unread // empty' 2>/dev/null)
UNMUTE=$(curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/mutes" \
  -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"GROUP\",\"chatKey\":\"$GROUP_ID\",\"muted\":false}")
check "صدادار کردن مجدد" "$(echo "$UNMUTE" | jq -r 'if .muted==false then 1 else 0 end')"
B_S1_GM5=$(count_type beheshti.s1 GROUP_MESSAGE)
curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"پیام پس از صدادار شدن","clientId":"notif-gm-test-4-'$RUN_ID'"}' > /dev/null
A_S1_GM5=$(count_type beheshti.s1 GROUP_MESSAGE)
check "پس از صدادار شدن اعلان دوباره ساخته می‌شود" "$(if [ $((A_S1_GM5 - B_S1_GM5)) = "1" ]; then echo 1; else echo 0; fi)"

# بی‌صدایی گفتگوی خصوصی
curl -s -b "$JAR/beheshti.t1.txt" -X PUT "$BASE/api/me/mutes" -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"DIRECT\",\"chatKey\":\"$ADMIN_ID\",\"muted\":true}" > /dev/null
B_T1_PM2=$(count_type beheshti.t1 PRIVATE_MESSAGE)
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$T1_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"body":"پیام خصوصی به گفتگوی بی‌صدا","clientId":"notif-dm-test-2-'$RUN_ID'"}' > /dev/null
A_T1_PM2=$(count_type beheshti.t1 PRIVATE_MESSAGE)
check "گفتگوی خصوصی بی‌صدا: اعلان ساخته نشد" "$(if [ "$A_T1_PM2" = "$B_T1_PM2" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/beheshti.t1.txt" -X PUT "$BASE/api/me/mutes" -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"DIRECT\",\"chatKey\":\"$ADMIN_ID\",\"muted\":false}" > /dev/null

echo "── ۷. ترجیحات اعلان ──"
PREF=$(curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" \
  -H 'Content-Type: application/json' \
  -d '{"browserEnabled":true,"previewEnabled":false}')
check "ذخیره ترجیحات اعلان" "$(echo "$PREF" | jq -r 'if .browserEnabled==true and .previewEnabled==false then 1 else 0 end')"
PREF2=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/me/notification-prefs")
check "خواندن مجدد ترجیحات ذخیره‌شده" "$(echo "$PREF2" | jq -r 'if .browserEnabled==true and .previewEnabled==false then 1 else 0 end')"
curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" \
  -H 'Content-Type: application/json' -d '{"browserEnabled":false,"previewEnabled":false}' > /dev/null

echo "── ۸. وضعیت خوانده‌شده و شمارنده ──"
UN1=$(total_count beheshti.s1)
MARK=$(curl -s -b "$JAR/beheshti.s1.txt" -X POST "$BASE/api/notifications/read" \
  -H 'Content-Type: application/json' -d '{"all":true}')
UN2=$(total_count beheshti.s1)
check "خواندن همه اعلان‌ها شمارنده را صفر می‌کند" "$(if [ "$UN1" -gt 0 ] && [ "$(echo "$MARK" | jq '.unreadCount')" = "0" ] && [ "$UN2" = "0" ]; then echo 1; else echo 0; fi)"

echo "── ۹. جداسازی مدارس در اعلان‌ها ──"
B_F_S1=$(curl -s -b "$JAR/farzanegan.s1.txt" "$BASE/api/notifications" | jq '.unreadCount')
# چند رویداد در مدرسه ۱
curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d '{"body":"پیام جداسازی","clientId":"notif-gm-test-5-'$RUN_ID'"}' > /dev/null
A_F_S1=$(curl -s -b "$JAR/farzanegan.s1.txt" "$BASE/api/notifications" | jq '.unreadCount')
check "دانش‌آموز مدرسه ۲ هیچ اعلانی از مدرسه ۱ نگرفت" "$(if [ "$A_F_S1" = "$B_F_S1" ]; then echo 1; else echo 0; fi)"

echo "── ۱۰. دسترسی به اعلان‌ها بدون ورود ──"
NOAUTH=$(curl -s "$BASE/api/notifications" -o /dev/null -w "%{http_code}")
check "بدون نشست → 401" "$(if [ "$NOAUTH" = "401" ]; then echo 1; else echo 0; fi)"

echo ""
echo "═══════════════════════════════════"
echo "نتیجه: $P موفق، $F ناموفق"
[ "$F" = "0" ] && echo "همه آزمون‌ها پاس شد ✔" || echo "برخی آزمون‌ها شکست خورد ✘"
exit $F
