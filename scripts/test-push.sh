#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# آزمون پوش نوتیفیکیشن واقعی مرورگر (Web Push) — فقط نتایج واقعی HTTP
# پیش‌نیاز: next dev روی :3000 + push-test-server روی :3057
# اجرای مجدد‌پذیر است (RESET ابتدای اسکریپت). DMها از مدیر مدرسه (مجاز همیشه).
# ═══════════════════════════════════════════════════════════════
BASE="http://localhost:3000"
MOCK="https://127.0.0.1:3057"
PASS="Pass@123"
JAR="/tmp/danyar-push-test"
RUN_ID=$(date +%s)
mkdir -p "$JAR"

P=0; F=0
ok()  { P=$((P+1)); echo "✔ [OK] $1"; }
bad() { F=$((F+1)); echo "✘ [FAIL] $1"; }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi }

GROUP_ID="cmv1aryqy000elokrx43nz39n"      # ریاضی هفتم۱ (مدرسه ۱)

echo "── پیش‌نیازها ──"
MOCK_OK=$(curl -sk "$MOCK/health" | jq -r '.ok' 2>/dev/null)
if [ "$MOCK_OK" != "true" ]; then
  echo "  push-test-server بالا نمی‌آید — شروع می‌کنم…"
  (cd "$(dirname "$0")/../mini-services/push-test-server" && PORT=3057 nohup bun run dev > /tmp/push-test-server.log 2>&1 &)
  sleep 3
  MOCK_OK=$(curl -sk "$MOCK/health" | jq -r '.ok' 2>/dev/null)
fi
check "سرویس شبیه‌ساز پوش در دسترس است" "$(if [ "$MOCK_OK" = "true" ]; then echo 1; else echo 0; fi)"
curl -sk -X POST "$MOCK/reset" > /dev/null

echo "── ورود کاربران ──"
login() { # $1=user $2=pass $3=jar [$4=realm]
  curl -s -c "$JAR/$3.txt" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"${4:-app}\"}" -o /dev/null
}
login superadmin Admin@1234 sa superadmin && ok "مدیر کل"
for u in beheshti.admin beheshti.t1 beheshti.s1 beheshti.s2; do login "$u" "$PASS" "$u"; done && ok "کاربران مدرسه ۱"
login farzanegan.admin "$PASS" fadmin && ok "مدیر مدرسه ۲"

S1_ID=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/me" | jq -r '.user.id')
ADM_ID=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/me" | jq -r '.user.id')

# ضربان صف پوش: درخواست‌های مکرر اعلان‌ها تا اسکن فرصت‌طلبانه اجرا شود
heartbeat() { # $1=seconds
  local t=0
  while [ $t -lt "$1" ]; do
    curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/notifications?count=1" -o /dev/null 2>/dev/null
    curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications?count=1" -o /dev/null 2>/dev/null
    sleep 1; t=$((t+1))
  done
}

echo "── کلیدهای اشتراک آزمون (یک جفت برای همه دستگاه‌های شبیه‌سازی‌شده) ──"
KEYS_JSON=$(bun -e '
const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function enc(b){let o="",bits=0,acc=0;for(const x of new Uint8Array(b)){acc=(acc<<8)|x;bits+=8;while(bits>=6){bits-=6;o+=B64U[(acc>>bits)&63];}}if(bits>0)o+=B64U[(acc<<(6-bits))&63];return o;}
const auth = crypto.getRandomValues(new Uint8Array(16));
console.log(JSON.stringify({ p256dh: enc(raw), auth: enc(auth), privateJwk: privJwk }));
')
P256DH=$(echo "$KEYS_JSON" | jq -r '.p256dh')
AUTH=$(echo "$KEYS_JSON" | jq -r '.auth')
REG=$(curl -sk -X POST "$MOCK/register-keys" -H 'Content-Type: application/json' \
  -d "{\"privateJwk\":$(echo "$KEYS_JSON" | jq -c '.privateJwk'),\"auth\":\"$AUTH\"}")
check "ثبت کلید رمزگشایی در شبیه‌ساز" "$(echo "$REG" | jq -r 'if .ok == true then 1 else 0 end')"

# اشتراک: $1=jar $2=endpoint-tag → خروجی id
subscribe() {
  curl -s -b "$JAR/$1.txt" -X POST "$BASE/api/push/subscribe" -H 'Content-Type: application/json' \
    -d "{\"endpoint\":\"$MOCK/push/$2\",\"keys\":{\"p256dh\":\"$P256DH\",\"auth\":\"$AUTH\"},\"deviceId\":\"dev-$2\",\"label\":\"TestBrowser / TestOS\"}"
}

# بهداشت اجرای مجدد‌پذیر: لغو اشتراک‌های اجراهای قبلی همه کاربران آزمون.
# شبیه‌ساز به همه endpointها 201 برمی‌گرداند، پس اشتراک‌های کهنه هرگز 404 نمی‌گیرند
# و اگر پاک نشوند، هر پیام به ده‌ها endpoint قدیمی ارسال می‌شود و زمانِ پردازش صف
# از سقف انتظار آزمون عبور می‌کند (تجربه ۷۵ اشتراک انباشته!).
for u in beheshti.s1 beheshti.s2 beheshti.admin beheshti.t1; do
  curl -s -b "$JAR/$u.txt" -X POST "$BASE/api/push/unsubscribe" -H 'Content-Type: application/json' -d '{"all":true}' > /dev/null
done

echo "── ۱. وضعیت پیکربندی و اشتراک ──"
CFG=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/push/config")
check "config: VAPID پیکربندی شده" "$(echo "$CFG" | jq -r 'if .vapidConfigured == true then 1 else 0 end')"
check "config: کلید عمومی برگشته و هیچ کلید خصوصی در پاسخ نیست" "$(echo "$CFG" | jq -r 'if ([keys[] | select(test("private|secret"; "i"))] | length) == 0 and ((.publicKey // "") | length) > 20 then 1 else 0 end')"
check "config: پلتفرم و مدرسه فعال" "$(echo "$CFG" | jq -r 'if .platformEnabled == true and .schoolEnabled == true then 1 else 0 end')"
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/push/config")
check "config بدون نشست → 401" "$(if [ "$UNAUTH" = "401" ]; then echo 1; else echo 0; fi)"

SUB1=$(subscribe beheshti.s1 "s1-a1-$RUN_ID")
check "اشتراک دستگاه s1 ثبت شد" "$(echo "$SUB1" | jq -r 'if .ok == true then 1 else 0 end')"
SUB1_ID=$(echo "$SUB1" | jq -r '.id')
SUB1B=$(subscribe beheshti.s1 "s1-a1-$RUN_ID")
check "ثبت مجدد همان endpoint → همان دستگاه (بدون ردیف تکراری)" "$(if [ "$(echo "$SUB1B" | jq -r '.id')" = "$SUB1_ID" ]; then echo 1; else echo 0; fi)"
subscribe beheshti.s1 "s1-a2-$RUN_ID" > /dev/null
DEVS=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/push/config" | jq '.devices')
check "دو دستگاه برای s1 ثبت شد" "$(echo "$DEVS" | jq -r --arg r "$RUN_ID" '[.[] | select((.deviceId // "") | endswith("-" + $r))] | length | if . == 2 then 1 else 0 end')"
check "پاسخ devices بدون endpoint و کلید" "$(echo "$DEVS" | jq -r 'if ([.[] | (has("endpoint") or has("p256dh") or has("auth"))] | any) == false then 1 else 0 end')"
subscribe beheshti.s2 "s2-b1-$RUN_ID" > /dev/null
subscribe beheshti.admin "adm-c1-$RUN_ID" > /dev/null
subscribe beheshti.t1 "t1-d1-$RUN_ID" > /dev/null
subscribe fadmin "fa-e1-$RUN_ID" > /dev/null

# غیرمجاز: دستگاه کاربر دیگر
DM4000=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/beheshti.s2.txt" -X PATCH "$BASE/api/push/devices/$SUB1_ID" -H 'Content-Type: application/json' -d '{"enabled":false}')
check "s2 نمی‌تواند دستگاه s1 را تغییر دهد (404)" "$(if [ "$DM4000" = "404" ]; then echo 1; else echo 0; fi)"

mock_count() { curl -sk "$MOCK/records?tag=$1" | jq '[.records[] | select(.status < 300)] | length'; }
mock_all() { curl -sk "$MOCK/records?tag=$1"; }
wait_mock() { # $1=tag $2=min-ok-count $3=timeout-s
  local t=0
  while [ $t -lt "$3" ]; do
    local c=$(mock_count "$1")
    if [ "$c" -ge "$2" ]; then return 0; fi
    sleep 1; t=$((t+1))
  done
  return 1
}

echo "── ۲. پیام خصوصی: پوش + حریم خصوصی محتوا ──"
# ترجیحات پایه: پیش‌نمایش خاموش + همه رویدادها (اجرای قبلی نباید اثر بگذارد)
curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" -H 'Content-Type: application/json' \
  -d '{"previewEnabled":false,"pushEventTypes":[]}' > /dev/null
B_NOTIF=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications" | jq -r '.unreadCount')
S1_TAG="s1-a1-$RUN_ID"
A2_TAG="s1-a2-$RUN_ID"
# پایه قبل از محرک — صف پوش سریع است و اگر بعد از ارسال خوانده شود، رقابتی می‌شود
B_S1=$(mock_count "$S1_TAG")
DM=$(curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' \
  -d "{\"body\":\"رمز جلسه ریاضی ۱۲۳۴۵\",\"clientId\":\"push-dm-1-$RUN_ID\"}")
check "پیام خصوصی ثبت شد" "$(echo "$DM" | jq -r 'if .message.id then 1 else 0 end')"
wait_mock "$S1_TAG" $((B_S1 + 1)) 10 && ok "پوش به دستگاه s1 رسید" || bad "پوش به دستگاه s1 نرسید"
check "دقیقاً یک ارسال موفق برای این رویداد (بدون تکرار)" "$(if [ "$(mock_count "$S1_TAG")" = "$((B_S1 + 1))" ]; then echo 1; else echo 0; fi)"
REC=$(mock_all "$S1_TAG")
check "هدر Authorization (VAPID) در ارسال هست" "$(echo "$REC" | jq -r --argjson i "$B_S1" 'if .records[$i].authHeader == "PRESENT" then 1 else 0 end')"
PAYLOAD=$(echo "$REC" | jq -r --argjson i "$B_S1" '.records[$i].payload // ""')
check "payload رمزگشایی شد" "$(if [ -n "$PAYLOAD" ]; then echo 1; else echo 0; fi)"
check "پیش‌فرض: متن خصوصی پیام در اعلان نیست" "$(echo "$PAYLOAD" | jq -r 'if ((.body | contains("۱۲۳۴۵")) == false and .body == "یک پیام خصوصی جدید دارید") then 1 else 0 end')"
check "عنوان عمومی «پیام خصوصی جدید»" "$(echo "$PAYLOAD" | jq -r 'if .title == "پیام خصوصی جدید" then 1 else 0 end')"
check "لینک اعلان به گفتگوی فرستنده است" "$(echo "$PAYLOAD" | jq -r --arg id "$ADM_ID" 'if .link == ("/chats/dm/" + $id) then 1 else 0 end')"
check "conversationKey برای ممنوعیت نمایش روی گفتگوی باز" "$(echo "$PAYLOAD" | jq -r --arg id "$ADM_ID" 'if .conversationKey == ("dm:" + $id) then 1 else 0 end')"

curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" -H 'Content-Type: application/json' \
  -d '{"previewEnabled":true}' > /dev/null
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام دوم با پیش‌نمایش\",\"clientId\":\"push-dm-2-$RUN_ID\"}" > /dev/null
wait_mock "$S1_TAG" $((B_S1 + 2)) 10
REC2=$(mock_all "$S1_TAG" | jq -r --argjson i "$((B_S1 + 1))" '.records[$i].payload // ""')
check "با انتخاب کاربر: پیش‌نمایش متن در اعلان هست" "$(echo "$REC2" | jq -r 'if (.body // "") | contains("پیام دوم با پیش‌نمایش") then 1 else 0 end')"

echo "── ۳. انتخاب نوع رویداد ──"
curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" -H 'Content-Type: application/json' \
  -d '{"previewEnabled":true,"pushEventTypes":["GROUP_MESSAGE","ASSIGNMENT_NEW","FEEDBACK_POSTED","LIVE_SESSION_NEW","SAMPLEQ_NEW","SCHOOL_ANNOUNCEMENT","ATTENDANCE"]}' > /dev/null
B_NOTIF=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications" | jq -r '.unreadCount')
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام سوم — نوع خاموش\",\"clientId\":\"push-dm-3-$RUN_ID\"}" > /dev/null
sleep 4
BEFORE=$(mock_count "$S1_TAG")
check "رویداد خاموش‌شده → پوش نمی‌رود" "$(if [ "$BEFORE" = "$((B_S1 + 2))" ]; then echo 1; else echo 0; fi)"
A_NOTIF=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/notifications" | jq -r '.unreadCount')
check "اعلان درون‌برنامه‌ای همچنان ثبت شده" "$(if [ "$A_NOTIF" -gt "$B_NOTIF" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/notification-prefs" -H 'Content-Type: application/json' \
  -d '{"previewEnabled":true,"pushEventTypes":[]}' > /dev/null   # خالی = همه

echo "── ۴. پیام گروهی و پیام‌های متوالی ──"
A2_TAG="s1-a2-$RUN_ID"
# پایه قبل از محرک (صف سریع است — خواندن پایه بعد از ارسال رقابتی می‌شود)
B_A2=$(mock_count "$A2_TAG")
GM=$(curl -s -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام گروهی آزمون ۱\",\"clientId\":\"push-gm-1-$RUN_ID\"}")
check "پیام گروهی ثبت شد" "$(echo "$GM" | jq -r 'if .message.id then 1 else 0 end')"
wait_mock "$A2_TAG" $((B_A2 + 1)) 12 && ok "پوش گروهی به دستگاه دوم s1 رسید" || bad "پوش گروهی به s1 نرسید"
REC_GM=$(mock_all "$A2_TAG" | jq -r --argjson i "$B_A2" '.records[$i].payload // ""')
check "پوش گروهی tag یکسان گفتگو دارد (تجمیع در اعلان)" "$(echo "$REC_GM" | jq -r --arg id "$GROUP_ID" 'if .tag == ("group:" + $id) then 1 else 0 end')"
curl -s -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام گروهی آزمون ۲\",\"clientId\":\"push-gm-2-$RUN_ID\"}" > /dev/null
wait_mock "$A2_TAG" $((B_A2 + 2)) 12
check "پیام متوالی → هر رویداد دقیقاً یک پوش (ضدتکرار)" "$(if [ "$(mock_count "$A2_TAG")" = "$((B_A2 + 2))" ]; then echo 1; else echo 0; fi)"
B_S1_GM_P=$(mock_count "$A2_TAG")
DUP=$(curl -s -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام گروهی آزمون ۲\",\"clientId\":\"push-gm-2-$RUN_ID\"}")
sleep 4
check "تلاش مجدد همان پیام → بدون پوش جدید" "$(if [ "$(echo "$DUP" | jq '.duplicate')" = "true" ] && [ "$(mock_count "$A2_TAG")" = "$B_S1_GM_P" ]; then echo 1; else echo 0; fi)"
check "فرستنده برای پیام خودش پوش نمی‌گیرد" "$(if [ "$(mock_count "s2-b1-$RUN_ID")" = "0" ]; then echo 1; else echo 0; fi)"

echo "── ۵. بی‌صدایی گفتگو ──"
MUTE=$(curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/mutes" -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"GROUP\",\"chatKey\":\"$GROUP_ID\",\"muted\":true}")
check "گفتگو بی‌صدا شد" "$(echo "$MUTE" | jq -r 'if .ok == true then 1 else 0 end')"
curl -s -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام روی بی‌صدا\",\"clientId\":\"push-gm-3-$RUN_ID\"}" > /dev/null
sleep 4
check "گفتگوی بی‌صدا → بدون پوش" "$(if [ "$(mock_count "$A2_TAG")" = "$B_S1_GM_P" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/beheshti.s1.txt" -X PUT "$BASE/api/me/mutes" -H 'Content-Type: application/json' \
  -d "{\"chatType\":\"GROUP\",\"chatKey\":\"$GROUP_ID\",\"muted\":false}" > /dev/null
curl -s -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/chats/group/$GROUP_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"بعد از صدادار شدن\",\"clientId\":\"push-gm-4-$RUN_ID\"}" > /dev/null
wait_mock "$A2_TAG" $((B_S1_GM_P + 1)) 12 && ok "پس از صدادار شدن پوش از سر گرفته شد" || bad "پوش پس از صدادار شدن از سر نگرفت"

echo "── ۶. اطلاعیه مدیر مدرسه (عضو چند گروه = یک پوش) ──"
ANN=$(curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/announcements" -H 'Content-Type: application/json' \
  -d "{\"body\":\"اطلاعیه آزمون پوش $RUN_ID\",\"subjectGroupIds\":[\"$GROUP_ID\"]}")
check "اطلاعیه ثبت شد" "$(echo "$ANN" | jq -r 'if .ok == true then 1 else 0 end')"
# انتظار بر اساس محتوا: اطلاعیه باید روی دستگاه s1 برسد
t=0; while [ $t -lt 15 ]; do
  C=$(curl -sk "$MOCK/records?tag=$S1_TAG" | jq '[.records[] | select((.payload // "") | contains("اطلاعیه آزمون پوش"))] | length')
  [ "$C" -ge 1 ] && break; sleep 1; t=$((t+1))
done
S1_ANN=$(curl -sk "$MOCK/records?tag=$S1_TAG" | jq '[.records[] | select(.payload != null and ((.payload | tostring) | contains("اطلاعیه آزمون پوش")))] | length')
check "اطلاعیه روی دستگاه s1 دقیقاً یک‌بار رسید" "$(if [ "$S1_ANN" = "1" ]; then echo 1; else echo 0; fi)"
FA_ANN=$(curl -sk "$MOCK/records?tag=fa-e1-$RUN_ID" | jq '[.records[] | select(.payload != null and ((.payload | tostring) | contains("اطلاعیه آزمون پوش")))] | length')
check "مدرسه دیگر اطلاعیه را نگرفت" "$(if [ "$FA_ANN" = "0" ]; then echo 1; else echo 0; fi)"

echo "── ۷. تکلیف ──"
ASG=$(curl -s -b "$JAR/beheshti.t1.txt" -X POST "$BASE/api/assignments" -H 'Content-Type: application/json' \
  -d "{\"title\":\"تکلیف پوش $RUN_ID\",\"description\":\"تست\",\"answerMode\":\"BOTH\",\"subjectGroupId\":\"$GROUP_ID\"}")
check "تکلیف ساخته شد" "$(echo "$ASG" | jq -r 'if .id then 1 else 0 end')"
wait_mock "$A2_TAG" 5 12 && ok "پوش تکلیف به دانش‌آموز رسید" || bad "پوش تکلیف نرسید"

echo "── ۸. کلید پلتفرم: خاموش/روشن و TTL صف ──"
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push" -H 'Content-Type: application/json' -d '{"platformEnabled":false}' > /dev/null
SUBCFG=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/beheshti.s2.txt" -X POST "$BASE/api/push/subscribe" -H 'Content-Type: application/json' \
  -d "{\"endpoint\":\"$MOCK/push/x-off-$RUN_ID\",\"keys\":{\"p256dh\":\"$P256DH\",\"auth\":\"$AUTH\"}}")
check "ثبت اشتراک در زمان خاموشی پلتفرم → 403" "$(if [ "$SUBCFG" = "403" ]; then echo 1; else echo 0; fi)"
B_OFF=$(mock_count "$S1_TAG")
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"در زمان خاموشی\",\"clientId\":\"push-off-1-$RUN_ID\"}" > /dev/null
sleep 4
check "خاموشی پلتفرم → بدون پوش" "$(if [ "$(mock_count "$S1_TAG")" = "$B_OFF" ]; then echo 1; else echo 0; fi)"

# کار معوق وقتی پلتفرم برگردد ارسال می‌شود
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push" -H 'Content-Type: application/json' -d '{"platformEnabled":true}' > /dev/null
heartbeat 13
check "کار معوق پس از روشن‌شدن پلتفرم ارسال شد" "$(if [ "$(mock_count "$S1_TAG")" -gt "$B_OFF" ]; then echo 1; else echo 0; fi)"

# TTL: کار قدیمی‌تر از عمر مجاز ارسال نمی‌شود
B_TTL=$(mock_count "$S1_TAG")
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push" -H 'Content-Type: application/json' -d '{"platformEnabled":false}' > /dev/null
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"برای آزمون TTL\",\"clientId\":\"push-ttl-1-$RUN_ID\"}" > /dev/null
sleep 3
BKD=$(bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();const r=await db.pushDelivery.updateMany({where:{status:'PENDING'},data:{createdAt:new Date(Date.now()-6*60*1000)}});console.log(r.count);await db.\$disconnect();")
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push" -H 'Content-Type: application/json' -d '{"platformEnabled":true}' > /dev/null
heartbeat 13
check "اعلان قدیمی‌تر از TTL → منقضی و ارسال نمی‌شود" "$(if [ "$BKD" -gt "0" ] && [ "$(mock_count "$S1_TAG")" = "$B_TTL" ]; then echo 1; else echo 0; fi)"

echo "── ۹. کلید مدرسه ──"
S1_SCHOOL_ID=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/push/schools" | jq -r '.schools[0].id')
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push/schools" -H 'Content-Type: application/json' \
  -d "{\"schoolId\":\"$S1_SCHOOL_ID\",\"enabled\":false}" > /dev/null
sleep 1
SP=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/school/push")
check "مدیر مدرسه ۱ خاموشی مدرسه خودش را می‌بیند" "$(echo "$SP" | jq -r 'if .schoolEnabled == false and .platformEnabled == true then 1 else 0 end')"
B_S1_A1=$(mock_count "$S1_TAG")
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"پیام در زمان خاموشی مدرسه۱\",\"clientId\":\"push-sch-1-$RUN_ID\"}" > /dev/null
sleep 4
check "خاموشی مدرسه ۱ → پوش کاربران آن متوقف" "$(if [ "$(mock_count "$S1_TAG")" = "$B_S1_A1" ]; then echo 1; else echo 0; fi)"
curl -s -b "$JAR/sa.txt" -X PUT "$BASE/api/admin/push/schools" -H 'Content-Type: application/json' \
  -d "{\"schoolId\":\"$S1_SCHOOL_ID\",\"enabled\":true}" > /dev/null
sleep 1
SP2=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/school/push")
check "بعد از روشن‌کردن، مدیر مدرسه فعال می‌بیند" "$(echo "$SP2" | jq -r 'if .active == true then 1 else 0 end')"
FPUT=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/fadmin.txt" -X PUT "$BASE/api/school/push")
check "مدیر مدرسه اجازه تغییر کلید پوش را ندارد (403)" "$(if [ "$FPUT" = "403" ]; then echo 1; else echo 0; fi)"

echo "── ۱۰. جداسازی مدارس و حساب‌ها ──"
FADM_DEVS=$(curl -s -b "$JAR/fadmin.txt" "$BASE/api/push/config" | jq --arg r "$RUN_ID" '[.devices[] | select((.deviceId // "") | endswith("-" + $r))] | length')
check "مدیر مدرسه ۲ فقط دستگاه خودش را می‌بیند" "$(if [ "$FADM_DEVS" = "1" ]; then echo 1; else echo 0; fi)"
S1_DEV_ID=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/push/config" | jq -r '.devices[0].id')
F404=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/fadmin.txt" -X PATCH "$BASE/api/push/devices/$S1_DEV_ID" -H 'Content-Type: application/json' -d '{"enabled":true}')
check "دسترسی به دستگاه کاربر مدرسه دیگر → 404" "$(if [ "$F404" = "404" ]; then echo 1; else echo 0; fi)"

# اتصال مجدد endpoint به حساب دیگر → اشتراک از حساب قبلی قطع می‌شود
curl -s -b "$JAR/fadmin.txt" -X POST "$BASE/api/push/subscribe" -H 'Content-Type: application/json' \
  -d "{\"endpoint\":\"$MOCK/push/adm-c1-$RUN_ID\",\"keys\":{\"p256dh\":\"$P256DH\",\"auth\":\"$AUTH\"},\"deviceId\":\"dev-adm-c1-$RUN_ID\"}" > /dev/null
ADM_DEVS=$(curl -s -b "$JAR/beheshti.admin.txt" "$BASE/api/push/config" | jq '.devices | length')
check "endpoint اتصال‌گرفته به حساب جدید از حساب قبلی حذف شد" "$(if [ "$ADM_DEVS" = "0" ]; then echo 1; else echo 0; fi)"

echo "── ۱۱. پاک‌سازی اشتراک ۴۰۴/۴۱۰ و تلاش مجدد ۴۲۹ ──"
subscribe beheshti.s1 "s1-e404-$RUN_ID" > /dev/null
S1_DEV_COUNT=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/push/config" | jq --arg r "$RUN_ID" '[.devices[] | select((.deviceId // "") | endswith("-" + $r))] | length')
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"برای پاک‌سازی ۴۰۴\",\"clientId\":\"push-404-1-$RUN_ID\"}" > /dev/null
sleep 6
S1_DEV_AFTER=$(curl -s -b "$JAR/beheshti.s1.txt" "$BASE/api/push/config" | jq --arg r "$RUN_ID" '[.devices[] | select((.deviceId // "") | endswith("-" + $r))] | length')
check "اشتراک ۴۰۴ خودکار پاک شد" "$(if [ "$S1_DEV_AFTER" = "$((S1_DEV_COUNT - 1))" ]; then echo 1; else echo 0; fi)"

subscribe beheshti.s1 "s1-eretry-$RUN_ID" > /dev/null
curl -s -b "$JAR/beheshti.admin.txt" -X POST "$BASE/api/chats/dm/$S1_ID/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"برای تلاش مجدد\",\"clientId\":\"push-retry-1-$RUN_ID\"}" > /dev/null
sleep 3
heartbeat 14
wait_mock "s1-eretry-$RUN_ID" 1 10 && ok "ارسال ناموفق (۴۲۹) → تلاش مجدد موفق" || bad "تلاش مجدد انجام نشد"
RETRY_STATUS=$(curl -sk "$MOCK/records?tag=s1-eretry-$RUN_ID" | jq '[.records[].status]')
check "نخستین تلاش ۴۲۹ و دوم موفق" "$(echo "$RETRY_STATUS" | jq -r 'if .[0] == 429 and (.[1] // 500) < 300 then 1 else 0 end')"

echo "── ۱۲. اعلان آزمایشی و لغو اشتراک ──"
TESTP=$(curl -s -b "$JAR/beheshti.s1.txt" -X POST "$BASE/api/push/test" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"dev-s1-a1-$RUN_ID\"}")
check "ارسال آزمایشی نتیجه واقعی موفق دارد" "$(echo "$TESTP" | jq -r 'if .ok == true and .sent >= 1 then 1 else 0 end')"
check "پیام صادقانه: پذیرش ≠ تضمین نمایش" "$(echo "$TESTP" | jq -r 'if ((.message | contains("تضمین")) or (.message | contains("بستگی"))) then 1 else 0 end')"
TESTBAD=$(curl -s -b "$JAR/beheshti.s1.txt" -X POST "$BASE/api/push/test" -H 'Content-Type: application/json' \
  -d '{"deviceId":"dev-nosuch"}')
check "دستگاه بدون اشتراک → خطای واقعی" "$(echo "$TESTBAD" | jq -r 'if .ok == false then 1 else 0 end')"

UNSUB=$(curl -s -b "$JAR/beheshti.s1.txt" -X POST "$BASE/api/push/unsubscribe" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"dev-s1-a1-$RUN_ID\"}")
check "لغو اشتراک این دستگاه" "$(echo "$UNSUB" | jq -r 'if .ok == true and .removed >= 1 then 1 else 0 end')"

echo "── ۱۳. گزارش مدیر کل ──"
ASTATS=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/push")
check "آمار ارسال موفق صفر نیست" "$(echo "$ASTATS" | jq -r 'if .stats.byStatus.SENT > 0 then 1 else 0 end')"
check "خطای منقضی TTL ثبت شده" "$(echo "$ASTATS" | jq -r 'if .stats.byStatus.EXPIRED > 0 then 1 else 0 end')"
check "خطای منقضی TTL در گزارش اخیر هست" "$(echo "$ASTATS" | jq -r 'if ([.recent[].lastError // "" | select(. == "TTL_EXPIRED")] | length) > 0 then 1 else 0 end')"
check "خطاهای عمومی بدون محتوای خصوصی" "$(echo "$ASTATS" | jq -r 'if ([.recent[].lastError // ""] | map(select(test("پیام|body|endpoint|p256dh"))) | length) == 0 then 1 else 0 end')"
check "کلید VAPID در پاسخ مدیر کل نیست" "$(echo "$ASTATS" | jq -r 'if ([keys[] | select(test("private|secret|key_"; "i"))] | length) == 0 and .vapidSubject != null then 1 else 0 end')"
SCHOOLS=$(curl -s -b "$JAR/sa.txt" "$BASE/api/admin/push/schools")
check "فهرست مدارس با وضعیت پوش" "$(echo "$SCHOOLS" | jq -r 'if (.schools | length) >= 2 and ([.schools[].push] | all(type == "boolean")) then 1 else 0 end')"
NP403=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/beheshti.admin.txt" "$BASE/api/admin/push")
check "مدیر مدرسه به آمار مدیر کل دسترسی ندارد (403)" "$(if [ "$NP403" = "403" ]; then echo 1; else echo 0; fi)"

echo ""
echo "════════════════════════════════════"
echo "نتیجه: $P موفق، $F ناموفق"
if [ $F -eq 0 ]; then echo "✅ همه آزمون‌های پوش پاس شد"; else echo "❌ $F آزمون ناموفق"; fi
exit $F
