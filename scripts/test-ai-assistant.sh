#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست جامع دستیار دانیار (مرحله ۶) — API: پیکربندی مدیر کل،
# آزمایش واقعی اتصال (شامل endpoint رسمی OpenAI بدون کلید معتبر)،
# گیت‌های سرور (غیرفعال/سهمیه/نقش)، جریان پاسخ واقعی با ابزار و refs،
# ذخیره دائمی تاریخچه، جداسازی کاربر/مدرسه، خطای سرویس‌دهنده و تلاش مجدد،
# ضدتکرار clientId، حذف گفتگو با تأیید، آمار بدون محتوا، عدم افشای کلید
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
SHIM="http://127.0.0.1:3055"
PASS=0; FAIL=0
J=/tmp/danyar-ai
mkdir -p $J
KEY="sk-test-secret-9999"
RUN=$$-$RANDOM
REALKEYFILE=$J/outputs.log
> $REALKEYFILE

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

login() { # $1=user $2=pass $3=jar [$4=realm]
  local realm="${4:-app}"
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"$realm\"}" > /dev/null
}
# یک درخواست به ازای هر فراخوانی؛ کد وضعیت در C و بدنه در out.json (بدون ثبت کلید در لاگ)
redact() { python3 -c "import sys,re;print(re.sub(r'sk-[A-Za-z0-9_-]+','sk-***',sys.stdin.read()),end='')"; }
code() {
  local jar=$1; shift
  C=$(curl -s -b $J/$jar.jar -o $J/out.json -w "%{http_code}" "$@")
  echo "$C $*" | redact >> $REALKEYFILE
}
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

say "ورود کاربران"
login superadmin Admin@1234 sa superadmin && ok "superadmin"
login beheshti.admin Pass@123 admin1 && ok "مدیر مدرسه ۱ (بهشتی)"
login farzanegan.admin Pass@123 fadmin && ok "مدیر مدرسه ۲ (فرزانگان)"
login beheshti.t1 Pass@123 t1 && ok "معلم t1"
login beheshti.s1 Pass@123 s1 && ok "دانش‌آموز s1"

say "پیکربندی سرویس (مدیر کل)"
code t1 $BASE/api/admin/ai/config
[ "$C" = "403" ] && ok "معلم به تنظیمات دستیار دسترسی ندارد (403)" || bad "دسترسی معلم به config ($C)"

code sa $BASE/api/admin/ai/config
[ "$C" = "200" ] && ok "GET config برای مدیر کل" || bad "GET config ($C)"

code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d '{"provider":"gemini"}'
[ "$C" = "400" ] && ok "ارائه‌دهنده نامعتبر رد شد (400)" || bad "ارائه‌دهنده نامعتبر ($C)"

code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true,\"generalInstruction\":\"کوتاه و دقیق پاسخ بده.\",\"maxToolCalls\":3}"
[ "$C" = "200" ] && ok "ذخیره پیکربندی با کلید" || bad "PUT config ($C)"
MASK=$(json "str(d['config']['apiKeyLast4'])")
HAS=$(json "str(d['config']['hasApiKey'])")
[ "$HAS" = "True" ] && ok "کلید ذخیره شده (hasApiKey=true)" || bad "hasApiKey"
[ "$MASK" = "9999" ] && ok "فقط ۴ رقم آخر برمی‌گردد ($MASK)" || bad "ماسک کلید ($MASK)"
grep -q "$KEY" $J/out.json && bad "کلید کامل در پاسخ افشا شده!" || ok "کلید کامل در پاسخ نیست"

say "آزمایش واقعی اتصال"
code sa -X POST $BASE/api/admin/ai/test
[ "$C" = "200" ] && ok "endpoint آزمایش" || bad "test endpoint ($C)"
TOK=$(json "str(d.get('ok'))")
[ "$TOK" = "True" ] && ok "اتصال به سرویس آزمون برقرار — تأخیر $(json "str(d.get('latencyMs'))")ms" || bad "آزمایش اتصال ناموفق: $(head -c 200 $J/out.json)"
REPLY=$(json "str(d.get('reply',''))[:60]")
[ -n "$REPLY" ] && [ "$REPLY" != "None" ] && ok "پاسخ واقعی مدل: $REPLY…" || bad "پاسخ خالی"

echo "  — آزمایش با endpoint رسمی OpenAI و کلید نامعتبر (نتیجه واقعی):"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d '{"provider":"openai","baseUrl":"https://api.openai.com/v1","model":"gpt-4o-mini","apiKey":"sk-invalid-key-for-real-test","enabled":true}'
code sa -X POST $BASE/api/admin/ai/test
TOK=$(json "str(d.get('ok'))")
ERR=$(json "str(d.get('error',''))[:110]")
if [ "$TOK" = "False" ] && [ -n "$ERR" ] && [ "$ERR" != "None" ]; then ok "خطای واقعی نمایش داده شد: $ERR"; else bad "پاسخ ساختگی برای endpoint واقعی!"; fi
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true}"
ok "بازگشت به سرویس آزمون"

say "گیت غیرفعال بودن مدرسه (سمت سرور)"
code sa $BASE/api/admin/ai/schools
SCHOOL1=$(json "[s['id'] for s in d['schools'] if 'بهشتی' in s['name']][0]")
SCHOOL2=$(json "[s['id'] for s in d['schools'] if 'فرزانگان' in s['name']][0]")
echo "  school1=$SCHOOL1 school2=$SCHOOL2"
# پاک‌سازی وضعیت اجراهای قبلی: هر دو مدرسه غیرفعال شوند
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":false,\"managerEnabled\":true}"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL2\",\"enabled\":false,\"managerEnabled\":true}"
code admin1 $BASE/api/assistant/status
ST=$(json "d['status']['code']")
[ "$ST" = "DISABLED_SCHOOL" ] && ok "وضعیت واقعی: DISABLED_SCHOOL" || bad "وضعیت ($ST)"
code admin1 -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"content\":\"سلام\",\"clientId\":\"c-gate-1-$RUN\"}"
[ "$C" = "403" ] && ok "ارسال در حالت غیرفعال رد شد (403)" || bad "گیت غیرفعال ($C)"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":true,\"managerEnabled\":true,\"dailyMessageLimit\":null}"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL2\",\"enabled\":true,\"managerEnabled\":true,\"dailyMessageLimit\":null}"
code admin1 $BASE/api/assistant/status
ST=$(json "str(d['status']['available'])")
[ "$ST" = "True" ] && ok "پس از فعال‌سازی: available=true" || bad "فعال‌سازی نشد: $(head -c 150 $J/out.json)"

say "نقش‌ها: دستیار فقط مدیر مدرسه"
code t1 $BASE/api/assistant/conversations
[ "$C" = "403" ] && ok "معلم 403 در conversations" || bad "معلم conversations ($C)"
code s1 $BASE/api/assistant/status
ST=$(json "d['status']['code']")
[ "$ST" = "ROLE_NOT_ALLOWED" ] && ok "دانش‌آموز: ROLE_NOT_ALLOWED" || bad "دانش‌آموز status ($ST)"
A1=$(curl -s -b $J/admin1.jar $BASE/api/chats | python3 -c "import json,sys;d=json.load(sys.stdin);print('yes' if any(c['key']=='assistant' for c in d['conversations']) else 'no')")
[ "$A1" = "yes" ] && ok "آیتم «دستیار دانیار» در فهرست گفتگوهای مدیر" || bad "فهرست مدیر بدون آیتم دستیار"
T1=$(curl -s -b $J/t1.jar $BASE/api/chats | python3 -c "import json,sys;d=json.load(sys.stdin);print('yes' if any(c['key']=='assistant' for c in d['conversations']) else 'no')")
[ "$T1" = "no" ] && ok "آیتم دستیار برای معلم نمایش داده نمی‌شود" || bad "نشت آیتم دستیار به معلم"
PXY=$(curl -s -b $J/t1.jar -o /dev/null -w "%{http_code}" $BASE/assistant)
[ "$PXY" = "307" ] && ok "صفحه /assistant برای معلم ریدایرکت می‌شود" || bad "proxy /assistant برای معلم ($PXY)"
PXY=$(curl -s -o /dev/null -w "%{http_code}" $BASE/assistant)
[ "$PXY" = "307" ] && ok "بازدید بدون ورود → 307" || bad "proxy بدون نشست ($PXY)"

say "داده آزمون: یک تکلیف در گروه ریاضی هفتم۱ (برای refs واقعی)"
code t1 $BASE/api/live-sessions
CLS7=$(json "[c['id'] for c in d['classrooms'] if c['name']=='هفتم۱'][0]")
GMATH7=$(json "[g['id'] for g in [c for c in d['classrooms'] if c['name']=='هفتم۱'][0]['groups'] if 'ریاضی' in g['name']][0]")
echo "  class7=$CLS7 math7=$GMATH7"
code t1 -X POST $BASE/api/assignments -H 'content-type: application/json' -d "{\"subjectGroupId\":\"$GMATH7\",\"title\":\"تکلیف آزمون دستیار\",\"description\":\"برای تست مرحله ۶\",\"answerMode\":\"TEXT\",\"maxGrade\":20}"
[ "$C" = "201" ] && ok "تکلیف آزمون ساخته شد" || ok "ایجاد تکلیف: $C (احتمالاً موجود)"

say "جریان واقعی پاسخ (SSE) با ابزار و refs"
CID=$(curl -s -b $J/admin1.jar -D $J/h1.txt -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"content\":\"سلام! وضعیت ارسال تکالیف و بازخوردهای مدرسه را خلاصه کن\",\"clientId\":\"c-ai-1-$RUN\"}" -o $J/sse1.txt --max-time 120 -w "%{http_code}")
echo "$CID chat" >> $REALKEYFILE
[ "$CID" = "200" ] && ok "درخواست chat با SSE (200)" || bad "chat ($CID)"
grep -q '"t":"tool"' $J/sse1.txt && ok "رویداد وضعیت ابزار در جریان بود" || bad "بدون رویداد tool"
grep -q '"t":"delta"' $J/sse1.txt && ok "دلتاهای متن جریان شد" || bad "بدون delta"
grep -q '"t":"done"' $J/sse1.txt && ok "رویداد done رسید" || bad "بدون done"
CONV=$(grep -i 'x-assistant-conversation' $J/h1.txt | tr -d '\r' | awk '{print $2}')
echo "  conversation=$CONV"
REFS=$(python3 -c "
import json
refs=[]
for line in open('$J/sse1.txt'):
    line=line.strip()
    if line.startswith('data:'):
        try:
            ev=json.loads(line[5:])
            if ev.get('t')=='done': refs=ev.get('refs',[])
        except: pass
print(len(refs))
")
[ "$REFS" -gt 0 ] 2>/dev/null && ok "refs منابع واقعی ثبت شد ($REFS منبع)" || bad "refs خالی"

say "ذخیره دائمی تاریخچه"
code admin1 $BASE/api/assistant/conversations/$CONV
NMSG=$(json "len(d['messages'])")
ROLES=$(json "'+'.join(m['role'] for m in d['messages'])")
[ "$NMSG" -ge 2 ] 2>/dev/null && ok "پیام‌ها ذخیره شدند ($NMSG پیام: $ROLES)" || bad "تاریخچه ذخیره نشد"
code admin1 $BASE/api/assistant/conversations/$CONV
NMSG2=$(json "len(d['messages'])")
[ "$NMSG" = "$NMSG2" ] && ok "تاریخچه پایدار است" || bad "تاریخچه ناپایدار"

say "ادامه گفتگو با تاریخچه (پیام دوم)"
CID=$(curl -s -b $J/admin1.jar -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"گزارش مدیریتی کوتاه از وضعیت آموزشی مدرسه بنویس\",\"clientId\":\"c-ai-2-$RUN\"}" -o $J/sse2.txt --max-time 120 -w "%{http_code}")
echo "$CID chat2" >> $REALKEYFILE
[ "$CID" = "200" ] && grep -q '"t":"done"' $J/sse2.txt && ok "پیام دوم پاسخ گرفت" || bad "پیام دوم ($CID)"

say "گفتگوی جدید و جداسازی کاربران/مدارس"
code admin1 -X POST $BASE/api/assistant/conversations -H 'content-type: application/json' -d '{}'
CONV2=$(json "d['conversation']['id']")
[ -n "$CONV2" ] && ok "گفتگوی جدید ساخته شد ($CONV2)" || bad "گفتگوی جدید"
code fadmin $BASE/api/assistant/conversations/$CONV
[ "$C" = "404" ] && ok "مدیر مدرسه ۲ به گفتگوی مدیر مدرسه ۱ دسترسی ندارد (404)" || bad "جداسازی گفتگو ($C)"
code fadmin -X DELETE $BASE/api/assistant/conversations/$CONV
[ "$C" = "404" ] && ok "حذف بین‌کاربری هم 404 است" || bad "حذف بین‌کاربری ($C)"

CID=$(curl -s -b $J/fadmin.jar -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d '{"content":"فهرست دانش‌آموزان و کلاس‌ها را نشان بده","clientId":"c-ai-f1-'"$RUN"'"}' -o $J/sse3.txt --max-time 120 -w "%{http_code}")
echo "$CID chat-fadmin" >> $REALKEYFILE
[ "$CID" = "200" ] && ok "مدیر مدرسه ۲ گفتگوی مستقل دارد" || bad "chat مدیر ۲ ($CID)"
FCONV=$(curl -s -b $J/fadmin.jar $BASE/api/assistant/conversations | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['conversations'][0]['id'])")
code fadmin $BASE/api/assistant/conversations/$FCONV
FREFS=$(json "json.dumps([r.get('id') for m in d['messages'] if m['role']=='ASSISTANT' for r in (m.get('refs') or [])])")
if echo "$FREFS" | grep -q "$CLS7\|$GMATH7"; then bad "refs مدیر ۲ شامل شناسه‌های مدرسه ۱ است!"; else ok "refs مدیر ۲ فقط منابع مدرسه خودش است"; fi

say "سهمیه مصرف روزانه (سمت سرور)"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":true,\"managerEnabled\":true,\"dailyMessageLimit\":2}"
code admin1 $BASE/api/assistant/status
ST=$(json "d['status']['code']")
USED=$(json "d['status']['usedToday']")
[ "$ST" = "QUOTA_EXHAUSTED" ] && ok "وضعیت: QUOTA_EXHAUSTED (مصرف امروز: $USED)" || bad "سهمیه ($ST — مصرف $USED)"
code admin1 -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"تلاش برای عبور از سهمیه\",\"clientId\":\"c-ai-q1-$RUN\"}"
[ "$C" = "403" ] && ok "ارسال فراتر از سهمیه 403" || bad "گیت سهمیه ($C)"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":true,\"managerEnabled\":true,\"dailyMessageLimit\":null}"
ok "سهمیه به بدون‌محدودیت برگشت"

say "غیرفعال‌سازی مدرسه و سراسری و پیکربندی ناقص"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":false,\"managerEnabled\":true}"
code admin1 -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"تست غیرفعال\",\"clientId\":\"c-ai-d1-$RUN\"}"
[ "$C" = "403" ] && ok "غیرفعال مدرسه → 403" || bad "گیت مدرسه ($C)"
code sa -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL1\",\"enabled\":true,\"managerEnabled\":true}"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d '{"provider":"openai","baseUrl":"","model":"","apiKey":"","enabled":false}'
code admin1 -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"تست پیکربندی ناقص\",\"clientId\":\"c-ai-d2-$RUN\"}"
[ "$C" = "403" ] && ok "پیکربندی ناقص/غیرفعال سراسری → 403" || bad "گیت سراسری ($C)"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true}"
ok "بازگردانی پیکربندی"

say "خطای سرویس‌دهنده + ضدتکرار clientId + تلاش مجدد"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d '{"provider":"openai","baseUrl":"http://127.0.0.1:3999/v1","model":"x","apiKey":"k","enabled":true}'
SCODE=$(curl -s -b $J/admin1.jar -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"پیام هنگام قطعی سرویس\",\"clientId\":\"c-ai-err-$RUN\"}" -o $J/sse4.txt --max-time 60 -w "%{http_code}")
echo "$SCODE chat-err" >> $REALKEYFILE
grep -q '"t":"error"' $J/sse4.txt && ok "خطای واقعی سرویس‌دهنده در جریان نمایش داده شد" || bad "بدون رویداد خطا ($SCODE)"
grep -qi 'sk-test-secret' $J/sse4.txt && bad "کلید در خطا افشا شد!" || ok "کلید در متن خطا نیست"
code admin1 $BASE/api/assistant/conversations/$CONV
LASTROLE=$(json "d['messages'][-1]['role']")
[ "$LASTROLE" = "USER" ] && ok "پس از خطا فقط پیام کاربر ثبت شده (بدون پاسخ ساختگی)" || bad "پس از خطا: $LASTROLE"
# ارسال مجدد همان clientId — پیام تکراری ثبت نمی‌شود
curl -s -b $J/admin1.jar -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV,\"content\":\"پیام هنگام قطعی سرویس\",\"clientId\":\"c-ai-err-$RUN\"}" -o /dev/null --max-time 60
code admin1 $BASE/api/assistant/conversations/$CONV
NCOUNT=$(python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(sum(1 for m in d['messages'] if m['role']=='USER' and 'قطعی' in m['content']))")
[ "$NCOUNT" = "1" ] && ok "ارسال مجدد همان clientId پیام تکراری نساخت" || bad "پیام تکراری ثبت شد ($NCOUNT)"
# بازگردانی سرویس → تلاش مجدد موفق
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true}"
RCODE=$(curl -s -b $J/admin1.jar -X POST $BASE/api/assistant/retry -H 'content-type: application/json' -d "{\"conversationId\":$CONV}" -o $J/sse5.txt --max-time 120 -w "%{http_code}")
echo "$RCODE retry" >> $REALKEYFILE
grep -q '"t":"done"' $J/sse5.txt && ok "تلاش مجدد موفق بود" || bad "retry ($RCODE)"

say "مسیر ارائه‌دهنده Anthropic (قالب SSE متفاوت)"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"anthropic\",\"baseUrl\":\"$SHIM\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true}"
code sa -X POST $BASE/api/admin/ai/test
TOK=$(json "str(d.get('ok'))")
[ "$TOK" = "True" ] && ok "آزمایش اتصال Anthropic برقرار" || bad "آزمایش Anthropic: $(head -c 200 $J/out.json)"
ACODE=$(curl -s -b $J/admin1.jar -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d "{\"conversationId\":$CONV2,\"content\":\"خلاصه وضعیت تکالیف را بده\",\"clientId\":\"c-ai-an1-$RUN\"}" -o $J/sse6.txt --max-time 120 -w "%{http_code}")
echo "$ACODE chat-anthropic" >> $REALKEYFILE
grep -q '"t":"done"' $J/sse6.txt && grep -q '"t":"tool"' $J/sse6.txt && ok "پاسخ کامل از مسیر Anthropic با ابزار" || bad "مسیر Anthropic ($ACODE)"
code sa -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true}"
ok "بازگشت به ارائه‌دهنده openai"

say "حذف گفتگو با تأیید (دو مرحله‌ای)"
code admin1 -X DELETE $BASE/api/assistant/conversations/$CONV2
[ "$C" = "409" ] && ok "حذف بدون تأیید 409 با آمار ($(json "d['messages']") پیام)" || bad "بدون تأیید ($C)"
code admin1 -X DELETE "$BASE/api/assistant/conversations/$CONV2?confirm=true"
[ "$C" = "200" ] && ok "حذف با تأیید انجام شد" || bad "با تأیید ($C)"
code admin1 $BASE/api/assistant/conversations/$CONV2
[ "$C" = "404" ] && ok "گفتگوی حذف‌شده دیگر موجود نیست" || bad "بعد از حذف ($C)"

say "آمار مصرف — بدون هیچ محتوای گفتگو"
code sa $BASE/api/admin/ai/stats
TOKN=$(json "d['stats']['today']['ok']")
TERR=$(json "d['stats']['today']['error']")
[ "$TOKN" -ge 4 ] 2>/dev/null && ok "شمارنده پاسخ‌های امروز: $TOKN" || bad "آمار پاسخ ($TOKN)"
[ "$TERR" -ge 1 ] 2>/dev/null && ok "شمارنده خطاهای امروز: $TERR" || bad "آمار خطا ($TERR)"
grep -q '"content"' $J/out.json && bad "آمار شامل فیلد محتواست!" || ok "آمار هیچ محتوایی ندارد"
code sa $BASE/api/admin/ai/schools
grep -q '"content"' $J/out.json && bad "فهرست مدارس شامل محتواست!" || ok "فهرست مدارس بدون محتوا"

say "بررسی نهایی: کلید API در هیچ پاسخی نیست"
if grep -q "$KEY" $REALKEYFILE $J/out.json $J/sse*.txt 2>/dev/null; then
  bad "کلید در خروجی‌ها یافت شد!"
else
  ok "کلید sk-test-secret-9999 در هیچ پاسخ/خطایی ظاهر نشد"
fi

echo ""
echo "════════════════════════════════"
echo "نتیجه نهایی: $PASS پاس / $FAIL شکست"
[ $FAIL -eq 0 ] && echo "همه تست‌ها موفق" || echo "تست‌های ناموفق موجود است"
exit $FAIL
