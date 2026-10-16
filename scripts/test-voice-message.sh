#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# تست API پیام صوتی (ویس) — فراداده duration/waveform
# ۱) آپلود WAV واقعی و ارسال با متا → GET شامل duration/waveform
# ۲) پاک‌سازی متای خراب (آرایه بلند/مقدار >۱/غیرعددی)
# ۳) متا فقط برای AUDIO پذیرفته می‌شود (FILE → بدون متا)
# ۴) هدایت ویس → نسخه مقصد همان موج را دارد
# ۵) پیش‌نمایش فهرست گفتگوها «🎤 پیام صوتی»
# اجرا: TEST_BASE=http://localhost:81 bash scripts/test-voice-message.sh
# ═══════════════════════════════════════════════════════════════
set -u
BASE="${TEST_BASE:-http://localhost:81}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
section() { echo; echo "▶ $1"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── تولید WAV واقعی ۱ ثانیه‌ای (سینوس ۴۴۰Hz) ──
python3 - "$TMP/voice.wav" << 'PYEOF'
import sys, wave, math, struct
path = sys.argv[1]
with wave.open(path, 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    frames = b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(8000))
    w.writeframes(frames)
PYEOF
[ -s "$TMP/voice.wav" ] && ok "فایل WAV واقعی ساخته شد ($(stat -c%s "$TMP/voice.wav") بایت)" || { bad "ساخت WAV ناموفق"; exit 1; }

# ── ورود معلم و دانش‌آموز مدرسه ۱ ──
section "ورود کاربران"
T=$(curl -s -c "$TMP/t.txt" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.t1","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
S=$(curl -s -c "$TMP/s.txt" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"beheshti.s1","password":"Pass@123","realm":"app"}' -o /dev/null -w "%{http_code}")
[ "$T" = "200" ] && ok "ورود معلم beheshti.t1" || bad "ورود معلم: $T"
[ "$S" = "200" ] && ok "ورود دانش‌آموز beheshti.s1" || bad "ورود دانش‌آموز: $S"
[ "$T" = "200" ] && [ "$S" = "200" ] || exit 1

# ── شناسه دانش‌آموز مقصد = خود beheshti.s1 (از /api/me) ──
SID=$(curl -s -b "$TMP/s.txt" "$BASE/api/me" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
[ -n "$SID" ] && ok "دانش‌آموز مقصد پیدا شد: $SID" || { bad "نامزد DM پیدا نشد"; exit 1; }

# ── ۱) آپلود + ارسال ویس با متا ──
section "ارسال ویس با فراداده"
UP=$(curl -s -b "$TMP/t.txt" -X POST $BASE/api/uploads -F "file=@$TMP/voice.wav;type=audio/wav")
KEY=$(echo "$UP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null)
[ -n "$KEY" ] && ok "آپلود صوت: $KEY" || { bad "آپلود ناموفق: $UP"; exit 1; }

WF='[0.1,0.4,0.8,1,0.7,0.3,0.05,0.6,0.9,0.5]'
R=$(curl -s -b "$TMP/t.txt" -X POST "$BASE/api/chats/dm/$SID/messages" -H 'Content-Type: application/json' \
  -d "{\"body\":\"\",\"clientId\":\"voice-api-$(date +%s)\",\"attachment\":{\"key\":\"$KEY\",\"duration\":3.2,\"waveform\":$WF}}")
MSGID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['id'])" 2>/dev/null)
DUR=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['attachment'].get('duration'))" 2>/dev/null)
WFOUT=$(echo "$R" | python3 -c "import sys,json; print(','.join(str(x) for x in json.load(sys.stdin)['message']['attachment'].get('waveform') or []))" 2>/dev/null)
[ -n "$MSGID" ] && ok "پیام ویس ثبت شد: $MSGID" || { bad "ارسال ویس ناموفق: $R"; exit 1; }
[ "$DUR" = "3.2" ] && ok "duration در پاسخ: $DUR" || bad "duration نادرست: $DUR"
[ "$WFOUT" = "$(echo $WF | tr -d ' ' | tr -d '[]' | sed 's/,/,/g')" ] && ok "waveform کامل در پاسخ" || bad "waveform نادرست: $WFOUT"

# GET همان گفتگو از سمت گیرنده — دانش‌آموز DM با خود معلم را می‌خواند (با صفحه‌بندی)
TID=$(curl -s -b "$TMP/t.txt" "$BASE/api/me" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
SW=$(python3 - "$BASE" "$TMP/s.txt" "$TID" "$MSGID" << 'PYEOF'
import sys, json, subprocess
base, cookie, tid, msgid = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
before = None
result = 'none'
for _ in range(6):
    url = f"{base}/api/chats/dm/{tid}/messages?limit=50"
    if before:
        import urllib.parse
        url += "&before=" + urllib.parse.quote(before)
    out = subprocess.run(["curl", "-s", "-b", cookie, url], capture_output=True, text=True).stdout
    d = json.loads(out)
    msgs = d.get("messages", [])
    if not msgs:
        break
    for m in msgs:
        if m["id"] == msgid:
            a = m.get("attachment") or {}
            result = f"{a.get('duration')}|{len(a.get('waveform') or [])}"
            break
    if result != 'none':
        break
    before = msgs[0]["createdAt"]
print(result)
PYEOF
)
[ "$SW" = "3.2|10" ] && ok "دانش‌آموز هم duration+waveform می‌بیند ($SW)" || bad "دریافت متا توسط گیرنده: «$SW»"

# ── ۲) پاک‌سازی متای خراب ──
section "اعتبارسنجی متای خراب"
UP2=$(curl -s -b "$TMP/t.txt" -X POST $BASE/api/uploads -F "file=@$TMP/voice.wav;type=audio/wav")
KEY2=$(echo "$UP2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")
BIG=$(python3 -c "print('['+','.join('2.5' for _ in range(200))+']')")
R2=$(curl -s -b "$TMP/t.txt" -X POST "$BASE/api/chats/dm/$SID/messages" -H 'Content-Type: application/json' \
  -d "{\"body\":\"\",\"clientId\":\"voice-junk-$(date +%s)\",\"attachment\":{\"key\":\"$KEY2\",\"duration\":99999,\"waveform\":$BIG}}")
W2=$(echo "$R2" | python3 -c "
import sys, json
a = json.load(sys.stdin)['message']['attachment']
wf = a.get('waveform') or []
print(f\"{a.get('duration')}|{len(wf)}|{max(wf) if wf else 0}\")" 2>/dev/null)
[ "$W2" = "3600|64|1" ] && ok "متای خراب پاک‌سازی شد (duration≤3600، سقف ۶۴ نمونه، clamp ≤۱): $W2" || bad "پاک‌سازی خراب: $W2"

# ── ۳) متا فقط برای AUDIO ──
section "متا برای غیرصوتی نادیده گرفته می‌شود"
printf 'test pdf content' > "$TMP/doc.txt"
UP3=$(curl -s -b "$TMP/t.txt" -X POST $BASE/api/uploads -F "file=@$TMP/doc.txt;type=text/plain")
KEY3=$(echo "$UP3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")
R3=$(curl -s -b "$TMP/t.txt" -X POST "$BASE/api/chats/dm/$SID/messages" -H 'Content-Type: application/json' \
  -d "{\"body\":\"فایل تست\",\"clientId\":\"file-meta-$(date +%s)\",\"attachment\":{\"key\":\"$KEY3\",\"duration\":9.9,\"waveform\":[0.9,0.9,0.9,0.9]}}")
H3=$(echo "$R3" | python3 -c "
import sys, json
a = json.load(sys.stdin)['message']['attachment']
print(f\"{a.get('duration')}|{a.get('waveform')}\")" 2>/dev/null)
[ "$H3" = "None|None" ] && ok "duration/waveform برای فایل غیرصوتی ذخیره نشد" || bad "متا برای FILE نشت کرده: $H3"

# ── ۴) هدایت ویس ──
section "هدایت پیام ویس"
# مقصد: گروه درسی معلم (از فهرست گفتگوها)
GID=$(curl -s -b "$TMP/t.txt" "$BASE/api/chats" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('conversations', []):
    if c.get('type') == 'GROUP': print(c['id']); break
" 2>/dev/null)
if [ -n "$GID" ]; then
  RF=$(curl -s -b "$TMP/t.txt" -X POST "$BASE/api/messages/$MSGID/forward" -H 'Content-Type: application/json' \
    -d "{\"targets\":[{\"kind\":\"GROUP\",\"id\":\"$GID\"}]}")
  OKF=$(echo "$RF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['results'][0]['ok'])" 2>/dev/null)
  [ "$OKF" = "True" ] && ok "هدایت ویس به گروه موفق" || bad "هدایت ناموفق: $RF"
  GF=$(curl -s -b "$TMP/t.txt" "$BASE/api/chats/group/$GID/messages")
  FW=$(echo "$GF" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d['messages']:
    if m.get('isForwarded') and (m.get('attachment') or {}).get('waveform'):
        a = m['attachment']
        print(f\"{len(a['waveform'])}|{a.get('duration')}\"); break
else: print('none')" 2>/dev/null)
  [ "$FW" = "10|3.2" ] && ok "نسخه هدایت‌شده همان موج و مدت را دارد ($FW)" || bad "موج نسخه هدایت: $FW"
else
  bad "گروهی برای هدایت پیدا نشد"
fi

# ── ۵) پیش‌نمایش فهرست گفتگو ──
section "پیش‌نمایش فهرست گفتگوها"
# ویس تازه به‌عنوان آخرین پیام گفتگو ارسال می‌شود
UP4=$(curl -s -b "$TMP/t.txt" -X POST $BASE/api/uploads -F "file=@$TMP/voice.wav;type=audio/wav")
KEY4=$(echo "$UP4" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")
curl -s -b "$TMP/t.txt" -X POST "$BASE/api/chats/dm/$SID/messages" -H 'Content-Type: application/json' \
  -d "{\"body\":\"\",\"clientId\":\"voice-final-$(date +%s)\",\"attachment\":{\"key\":\"$KEY4\",\"duration\":1.0,\"waveform\":[0.5,0.8,0.3,0.9,0.6]}}" > /dev/null
LP=$(curl -s -b "$TMP/s.txt" "$BASE/api/chats")
PV=$(echo "$LP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('conversations', []):
    if c.get('type') == 'DM':
        print((c.get('lastMessage') or {}).get('preview', '')); break
else: print('none')" 2>/dev/null)
echo "$PV" | rg -q "پیام صوتی" && ok "پیش‌نمایش آخرین پیام ویس: «$PV»" || bad "پیش‌نمایش ویس درست نیست: «$PV»"

echo
echo "═══ نتیجه: $PASS موفق ✅ | $FAIL ناموفق ❌ ═══"
[ "$FAIL" = "0" ]
