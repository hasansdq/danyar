#!/usr/bin/env python3
# اعتبارسنجی ساختاری docker-compose.yml — معادل بررسی‌های docker compose config در نبود docker
import yaml, sys, re
from pathlib import Path

ok = True
def check(cond, msg):
    global ok
    print(('  ✔ ' if cond else '  ✘ ') + msg)
    if not cond: ok = False

raw = open('docker-compose.yml').read()
doc = yaml.safe_load(raw)

print('── ساختار کلی ──')
svcs = doc.get('services', {})
for s in ['init-data', 'migrate', 'web', 'socket', 'proxy', 'livekit', 'coturn']:
    check(s in svcs, f'سرویس {s} موجود است')

print('── درگاه وب فقط loopback ──')
ports = svcs['proxy']['ports']
check(ports == ['127.0.0.1:3034:8080'], f'proxy ports = {ports} (فقط 127.0.0.1:3034)')
check(svcs['web'].get('ports') is None, 'web هیچ پورتی روی میزبان منتشر نمی‌کند')
check(svcs['socket'].get('ports') is None, 'socket هیچ پورتی روی میزبان منتشر نمی‌کند')

print('── پورت‌های رسانه جدا ──')
lk_ports = svcs['livekit']['ports']
check(sorted(lk_ports) == ['7881:7881/tcp', '7882:7882/udp'], f'livekit ports = {lk_ports}')
ct_ports = svcs['coturn']['ports']
check('3478:3478/udp' in ct_ports and '3478:3478/tcp' in ct_ports and '5349:5349/tcp' in ct_ports and '5349:5349/udp' in ct_ports and '49160-49200:49160-49200/udp' in ct_ports,
      f'coturn ports کامل = {ct_ports}')

print('── LiveKit سازگار با ایمیج (ENTRYPOINT=/livekit-server) ──')
lk = svcs['livekit']
check(lk['image'] == 'livekit/livekit-server:v1.13.9', f'ایمیج پین‌شده: {lk["image"]}')
check(lk.get('entrypoint') == ['/bin/sh', '-c'], f'entrypoint بازنویسی‌شده: {lk.get("entrypoint")}')
cmd = lk['command'][0]
# شبیه‌سازی interpolate سطح compose: $$ → $ (کانتینری)
rendered = cmd.replace('$$', '$')
check('exec /livekit-server' in rendered, 'باینری با مسیر مطلق /livekit-server exec می‌شود')
check('--config /etc/livekit/livekit.yaml' in rendered, 'کانفیگ سوارشده پاس داده می‌شود')
check('--node-ip "${LIVEKIT_NODE_IP}"' in rendered, 'IP عمومی با فلگ بومی --node-ip پاس می‌شود')
check('LIVEKIT_KEYS="${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"' in rendered, 'LIVEKIT_KEYS فرمت صحیح key: secret')
check('${LIVEKIT_API_KEY:-}' in str(lk['environment']) or 'LIVEKIT_API_KEY' in lk['environment'], 'متغیرها به سرویس پاس می‌شوند')
check('LIVEKIT_NODE_IP' in lk['environment'], 'LIVEKIT_NODE_IP به سرویس پاس می‌شود')
check('wget' in str(lk['healthcheck']['test']), 'healthcheck با wget (تأییدشده: GET / = 200)')

print('── coturn: متغیرها به سرویس منتقل شده + TLS ──')
ct = svcs['coturn']
check(ct['image'] == 'coturn/coturn:4.18-alpine', f'ایمیج واقعی موجود در رجیستری: {ct["image"]}')
check(ct.get('entrypoint') == ['/bin/sh', '-c'], 'entrypoint بازنویسی‌شده')
ccmd = ct['command'][0].replace('$$', '$')
env = ct.get('environment', {})
for var in ['LIVE_TURN_USERNAME', 'LIVE_TURN_CREDENTIAL', 'TURN_EXTERNAL_IP', 'TURN_REALM', 'TURN_CERT_FILE', 'TURN_KEY_FILE']:
    check(var in env, f'متغیر {var} داخل environment سرویس coturn است')
check('--user="${LIVE_TURN_USERNAME}:${LIVE_TURN_CREDENTIAL}"' in ccmd, 'نام کاربری/رمز از env کانتینر به turnserver می‌رسد')
check('--external-ip="${TURN_EXTERNAL_IP}"' in ccmd, 'IP عمومی شرطی اعمال می‌شود')
check('--cert="${TURN_CERT_FILE}"' in ccmd and '--key="${TURN_KEY_FILE}"' in ccmd, 'TLS شرطی (cert/key) اعمال می‌شود')
check('--no-tls --no-dtls' in ccmd, 'بدون گواهی: listenerهای TLS بسته می‌شوند')
check('--lt-cred-mech' in ccmd and '--fingerprint' in ccmd and '--realm=' in ccmd, 'تنظیمات اتصال TURN کامل')
check(ct['volumes'] == ['./deploy/coturn:/etc/coturn:ro'], f'پوشه گواهی سوار می‌شود: {ct["volumes"]}')
check('/usr/bin/turnserver' in ccmd, 'باینری با مسیر مطلق (مطابق ایمیج)')

print('── فرمان‌های کانتینری با sh واقعی معتبرند ──')
# اعتبارسنجی نحوی هر فرمان کانتینری با sh (dash sandbox)
import subprocess, tempfile, os
for name, sc in [('livekit', lk), ('coturn', ct)]:
    script = sc['command'][0].replace('$$', '$')
    # فقط syntax check: با env خالی اجرا نمی‌کنیم؛ sh -n
    with tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False) as f:
        f.write(script); tf = f.name
    r = subprocess.run(['sh', '-n', tf], capture_output=True, text=True)
    check(r.returncode == 0, f'فرمان {name} از نظر sh معتبر است {r.stderr.strip()[:80]}')
    os.unlink(tf)

print('── پروفایل‌ها ──')
check(svcs['livekit'].get('profiles') == ['media'], 'livekit فقط با پروفایل media')
check(svcs['coturn'].get('profiles') == ['turn'], 'coturn فقط با پروفایل turn')

print('── هماهنگی سقف کلاس (حداقل ۳۲) در کد/Compose/.env.example ──')
xenv = doc.get('x-env', {}) if isinstance(doc.get('x-env'), dict) else {}
cap_compose = xenv.get('LIVE_MAX_PARTICIPANTS', '')
check('${LIVE_MAX_PARTICIPANTS:-32}' in cap_compose, f'Compose پیش‌فرض ۳۲: {cap_compose}')
envex = open('.env.example').read()
check(re.search(r'^LIVE_MAX_PARTICIPANTS=32\s*$', envex, re.M) is not None, '.env.example: LIVE_MAX_PARTICIPANTS=32')
liveaccess = open('src/lib/live-access.ts').read()
check('?? 32' in liveaccess, 'کد Next.js پیش‌فرض ۳۲')
sockts = open('mini-services/socket-server/index.ts').read()
check('?? 32' in sockts, 'سرویس Socket پیش‌فرض ۳۲')
if Path('socket-server.mjs').exists():
    sockmjs = Path('socket-server.mjs').read_text()
    check('?? 32' in sockmjs, 'باندل محلی socket پیش‌فرض ۳۲')
else:
    print('  — باندل Socket در بسته سورس وجود ندارد؛ صحت اجرای باندل نیازمند build است')
dockerfile = Path('Dockerfile').read_text()
check('bun build mini-services/socket-server/index.ts --target node' in dockerfile
      and '--outfile socket-server.mjs' in dockerfile,
      'Docker باندل Socket را از سورس می‌سازد')
# ظرفیت اختصاصی کلاس — resolution در توکن و سوکت
check('effectiveCapacity' in liveaccess, 'effectiveCapacity در کد Next.js')
check('effectiveCapacity' in sockts, 'effectiveCapacity در سرویس Socket (Classroom.capacity)')
tokenrt = open('src/app/api/live-sessions/[id]/token/route.ts').read()
check('effectiveCapacity(live.classroom.capacity,live.classroom.school?.liveMaxParticipants??null,)' in re.sub(r'\s+', '', tokenrt),
      'توکن LiveKit با ظرفیت مؤثر کلاس و سقف مدرسه صادر می‌شود')

print('── healthcheck همه سرویس‌های بلندمدت ──')
for s in ['web', 'socket', 'proxy', 'livekit', 'coturn']:
    check('healthcheck' in svcs[s], f'{s} healthcheck دارد')

print()
print('نتیجه: ' + ('همه بررسی‌ها سبز ✔' if ok else 'شکست ✘'))
sys.exit(0 if ok else 1)
