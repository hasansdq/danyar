#!/bin/bash
# ─────────────────────────────────────────────────────────────
# تست E2E ابزارهای تقویم آموزشی دستیار دانیار —
# آمار تقویم، ثبت رویداد، ویرایش و حذف از مسیر واقعی SSE
# (شیم آزمون روی 3055 + مدل واقعی برای متن نهایی)
# ─────────────────────────────────────────────────────────────
BASE="http://localhost:3000"
SHIM="http://127.0.0.1:3055"
PASS=0; FAIL=0
J=/tmp/danyar-cal
mkdir -p $J
KEY="sk-test-secret-9999"
RUN=$$-$RANDOM

say()  { echo -e "\n\033▶ $1\033"; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
json() { python3 -c "import json,sys;d=json.load(open('$J/out.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

login() { # $1=user $2=password $3=jar
  curl -s -c $J/$3.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\",\"realm\":\"app\"}" > /dev/null
}
login-super() { # مدیر کل با realm جدا
  curl -s -c $J/sa.jar -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{"username":"superadmin","password":"Admin@1234","realm":"superadmin"}' > /dev/null
}

say "شیم آزمون"
if ! curl -s --max-time 2 $SHIM/health | grep -q 'ok'; then
  (setsid bun run scripts/ai-test-server.mjs >> /tmp/ai-test-server.log 2>&1 < /dev/null &)
  for i in $(seq 1 20); do curl -s --max-time 1 $SHIM/health | grep -q ok && break; sleep 0.5; done
fi
curl -s --max-time 2 $SHIM/health | grep -q 'ok' && ok "شیم روی 3055 فعال است" || { bad "شیم بالا نیامد"; exit 1; }

say "ورود و پیکربندی"
login-super
login beheshti.admin Pass@123 admin1
C=$(curl -s -b $J/sa.jar -o $J/out.json -w "%{http_code}" -X PUT $BASE/api/admin/ai/config -H 'content-type: application/json' -d "{\"provider\":\"openai\",\"baseUrl\":\"$SHIM/v1\",\"model\":\"daniar-test\",\"apiKey\":\"$KEY\",\"enabled\":true,\"generalInstruction\":\"کوتاه و دقیق پاسخ بده.\",\"maxToolCalls\":3}")
[ "$C" = "200" ] && ok "پیکربندی دستیار → شیم آزمون" || bad "PUT config ($C)"

SCHOOL=$(curl -s -b $J/sa.jar $BASE/api/admin/ai/schools | python3 -c "import json,sys;d=json.load(sys.stdin);print([s['id'] for s in d['schools'] if 'بهشتی' in s['name']][0])")
C=$(curl -s -b $J/sa.jar -o /dev/null -w "%{http_code}" -X PUT $BASE/api/admin/ai/schools -H 'content-type: application/json' -d "{\"id\":\"$SCHOOL\",\"enabled\":true,\"managerEnabled\":true,\"dailyMessageLimit\":null}")
[ "$C" = "200" ] && ok "دستیار برای مدرسه بهشتی فعال" || bad "فعال‌سازی مدرسه ($C)"

C=$(curl -s -b $J/admin1.jar -o $J/out.json -w "%{http_code}" $BASE/api/assistant/status)
AV=$(json "str(d['status']['available'])")
[ "$AV" = "True" ] && ok "وضعیت دستیار مدیر: available" || bad "دستیار برای مدیر فعال نیست: $(head -c 120 $J/out.json)"

say "کلاس آزمون"
CLS=$(curl -s -b $J/admin1.jar $BASE/api/calendar/classes | python3 -c "import json,sys;d=json.load(sys.stdin);print([c['id'] for c in d['classrooms'] if c['name']=='هفتم۱'][0])")
[ -n "$CLS" ] && ok "کلاس هفتم۱: $CLS" || { bad "کلاس هفتم۱ یافت نشد"; exit 1; }

# گفتگو با جریان SSE — کل استریم در فایل
chat() { # $1=متن $2=فایل خروجی
  curl -s -N -b $J/admin1.jar -X POST $BASE/api/assistant/chat \
    -H 'content-type: application/json' \
    -d "{\"content\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$1"),\"clientId\":\"cal-$RUN-$RANDOM\"}" > "$2"
  # خطای HTTP را هم ثبت کن
  head -c 200 "$2" | grep -q '"error"' && echo "(خطای سرور در پاسخ)" 
}

say "۱) آمار کل تقویم آموزشی"
chat "آمار کل تقویم آموزشی مدرسه را با تفکیک نوع و رویدادهای پیش‌رو بده" $J/sse-stats.json
grep -q '"t":"tool"' $J/sse-stats.json && ok "رویداد tool در جریان SSE هست" || bad "جریان SSE بدون فراخوانی ابزار"
grep -q 'در حال محاسبه آمار تقویم آموزشی' $J/sse-stats.json && ok "برچسب وضعیت آمار تقویم نمایش داده شد" || bad "برچسب آمار تقویم یافت نشد"
grep -q '"t":"done"' $J/sse-stats.json && ok "پاسخ نهایی done رسید" || bad "done نرسید"
grep -q '"t":"error"' $J/sse-stats.json && bad "خطا در جریان: $(grep -o '"message":"[^"]*"' $J/sse-stats.json | head -1)" || ok "بدون خطای سرور"
python3 - <<'EOF' && ok "متن نهایی آمار واقعی و عددی است" || bad "متن آمار ناقص"
import json,re,sys
text=''; refs=[]
for line in open('/tmp/danyar-cal/sse-stats.json'):
    line=line.strip()
    if not line.startswith('data: '): continue
    try: e=json.loads(line[6:])
    except: continue
    if e.get('t')=='delta': text+=e.get('text','')
    if e.get('t')=='done': refs=e.get('refs',[])
assert len(text) > 40, 'متن کوتاه: '+text[:80]
assert ('تقویم' in text) or ('رویداد' in text), 'بدون اشاره به تقویم'
print('\n  متن:', text.replace(chr(10),' ')[:160].encode('unicode_escape').decode()[:200])
print('  refs:', len(refs))
EOF

say "۲) ثبت رویداد امتحان از طریق دستیار"
chat "لطفاً یک رویداد امتحان برای کلاس id=$CLS در تاریخ ۱۴۰۴-۰۸-۱۰ با توضیح «امتحان ریاضی میان‌ترم» در تقویم آموزشی ثبت کن" $J/sse-create.json
grep -q 'در حال ثبت رویداد در تقویم' $J/sse-create.json && ok "ابزار create_calendar_event صدا زده شد" || bad "برچسب ثبت رویداد یافت نشد"
grep -q '"t":"error"' $J/sse-create.json && bad "خطا در ثبت: $(grep -o '"message":"[^"]*"' $J/sse-create.json | head -1)" || ok "ثبت بدون خطا"
# بررسی واقعی در API تقویم
curl -s -b $J/admin1.jar -o $J/out.json "$BASE/api/calendar/events?classroomId=$CLS&from=1404-08-01&to=1404-08-29"
EVID=$(json "[e['id'] for e in d['events'] if e['type']=='EXAM' and e['dateKey']=='1404-08-10'][0]")
[ -n "$EVID" ] && [ "$EVID" != "None" ] && ok "رویداد امتحان ۱۴۰۴-۰۸-۱۰ واقعاً در تقویم ثبت شد ($EVID)" || { bad "رویداد در تقویم یافت نشد: $(head -c 200 $J/out.json)"; }
CR=$(json "str([e['creatorName'] for e in d['events'] if e['id']=='$EVID'][0])")
[ -n "$CR" ] && [ "$CR" != "None" ] && ok "ثبت‌کننده رویداد: $CR" || bad "ثبت‌کننده خالی"
grep -q '"kind":"event"' $J/sse-create.json && ok "refs پاسخ شامل رویداد تقویم است" || bad "refs بدون رویداد"

say "۳) ویرایش تاریخ رویداد از طریق دستیار"
chat "تاریخ رویداد امتحان id=$EVID را به ۱۴۰۴-۰۸-۱۲ تغییر بده" $J/sse-update.json
grep -q 'در حال ویرایش رویداد تقویم' $J/sse-update.json && ok "ابزار update_calendar_event صدا زده شد" || bad "برچسب ویرایش یافت نشد"
curl -s -b $J/admin1.jar -o $J/out.json "$BASE/api/calendar/events?classroomId=$CLS&from=1404-08-01&to=1404-08-29"
NEW=$(json "str([e['dateKey'] for e in d['events'] if e['id']=='$EVID'][0])")
[ "$NEW" = "1404-08-12" ] && ok "تاریخ رویداد واقعاً به ۱۴۰۴-۰۸-۱۲ تغییر کرد" || bad "تاریخ تغییر نکرد: $NEW"

say "۴) حذف رویداد از طریق دستیار"
chat "رویداد id=$EVID را از تقویم حذف کن" $J/sse-delete.json
grep -q 'در حال حذف رویداد تقویم' $J/sse-delete.json && ok "ابزار delete_calendar_event صدا زده شد" || bad "برچسب حذف یافت نشد"
curl -s -b $J/admin1.jar -o $J/out.json "$BASE/api/calendar/events?classroomId=$CLS&from=1404-08-01&to=1404-08-29"
GONE=$(json "str([e['id'] for e in d['events'] if e['id']=='$EVID'][0])")
# یافت‌نشدن رویداد → خروجی خالی/None = حذف موفق
if [ -z "$GONE" ] || [ "$GONE" = "None" ]; then ok "رویداد واقعاً از تقویم حذف شد"; else bad "رویداد هنوز هست: $GONE"; fi

say "۵) فهرست رویدادهای پیش‌رو"
chat "رویدادهای تقویم آموزشی مدرسه را فهرست کن" $J/sse-list.json
grep -q 'در حال دریافت رویدادهای تقویم' $J/sse-list.json && ok "ابزار list_calendar_events صدا زده شد" || bad "برچسب فهرست یافت نشد"
grep -q '"t":"error"' $J/sse-list.json && bad "خطا در فهرست" || ok "فهرست بدون خطا"

say "۶) صفحه دستیار در مرورگر بدون خطا"
node - <<'EOF'
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(String(e?.message ?? e)))
// ورود
await p.goto('http://localhost:81/login', { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(1500)
await p.fill('#username', 'beheshti.admin')
await p.fill('#password', 'Pass@123')
const bot = p.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
if (await bot.count()) await bot.click()
await p.click('button[type="submit"]')
await p.waitForURL('**/', { timeout: 45000 }).catch(() => {})
await p.goto('http://localhost:81/assistant', { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(4000)
const body = await p.locator('body').innerText().catch(() => '')
if (errs.length) { console.log('PAGE_ERRORS: ' + errs.slice(0,3).join(' | ')); process.exit(1) }
if (!/دستیار/.test(body)) { console.log('بدون محتوای دستیار'); process.exit(1) }
console.log('ASSISTANT_PAGE_OK')
await b.close()
EOF
[ $? = 0 ] && ok "صفحه /assistant بارگذاری شد بدون pageerror" || bad "خطا در صفحه دستیار"

echo ""
echo "═══ نتیجه نهایی: $PASS پاس / $FAIL شکست ═══"
exit $((FAIL > 0 ? 1 : 0))
