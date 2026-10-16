#!/bin/bash
# تست جداسازی داده بین مدارس — هیچ مدیر مدرسه‌ای نباید به داده مدرسه دیگر دسترسی داشته باشد
set -e
BASE="http://localhost:3000"
JAR_A=/tmp/jar_super.txt
JAR_B=/tmp/jar_adminb.txt
rm -f $JAR_A $JAR_B

echo "── ۱) ورود مدیر کل"
curl -s -c $JAR_A -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"Admin@1234","realm":"superadmin"}' | head -c 120; echo

echo "── ۲) ایجاد مدرسه دوم"
SCHOOL_B=$(curl -s -b $JAR_A -X POST $BASE/api/schools -H 'Content-Type: application/json' \
  -d '{"name":"دبیرستان دوم آزمایشی"}')
SCHOOL_B_ID=$(echo "$SCHOOL_B" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$SCHOOL_B_ID" ]; then
  SCHOOL_B_ID=$(curl -s -b $JAR_A "$BASE/api/schools" | python3 -c "import sys,json; d=json.load(sys.stdin); print([s['id'] for s in d['schools'] if 'دوم آزمایشی' in s['name']][0])" 2>/dev/null)
fi
echo "schoolB=$SCHOOL_B_ID"

echo "── ۳) ایجاد مدیر مدرسه دوم"
curl -s -b $JAR_A -X POST $BASE/api/schools/$SCHOOL_B_ID/admin -H 'Content-Type: application/json' \
  -d '{"firstName":"مدیر","lastName":"دوم","nationalId":"1490000001"}' | head -c 150; echo

echo "── ۴) ورود مدیر دوم"
curl -s -c $JAR_B -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"1490000001","password":"123456","realm":"app"}' | head -c 120; echo

echo "── ۵) شناسه کلاس و گروه مدرسه اول (از دیتابیس)"
IDS=$(cd /home/z/my-project && bun -e "
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
  const g=await db.subjectGroup.findFirst({include:{classroom:true}});
  console.log(g.id+' '+g.classroom.id);
  await db.\$disconnect();
})()")
GROUP_A=$(echo $IDS | cut -d' ' -f1)
CLASS_A=$(echo $IDS | cut -d' ' -f2)
echo "groupA=$GROUP_A classA=$CLASS_A"

echo "── ۶) مدیر دوم سعی در خواندن کلاس مدرسه اول (انتظار: 404)"
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_B $BASE/api/classes/$CLASS_A

echo "── ۷) مدیر دوم سعی در خواندن پیام‌های گروه مدرسه اول (انتظار: 404)"
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_B $BASE/api/chats/group/$GROUP_A/messages

echo "── ۸) مدیر دوم سعی در ارسال پیام به گروه مدرسه اول (انتظار: 404)"
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_B -X POST $BASE/api/chats/group/$GROUP_A/messages \
  -H 'Content-Type: application/json' -d '{"body":"هک آزمایشی"}'

echo "── ۹) مدیر دوم سعی در چت خصوصی با معلم مدرسه اول (انتظار: 404)"
USER_A=$(cd /home/z/my-project && bun -e "
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
  const u=await db.user.findFirst({where:{username:'maryam.teacher'}}); if(!u){console.log('nonexistent-user')}else
  console.log(u ? u.id : 'nonexistent-user');
  await db.\$disconnect();
})()")
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_B $BASE/api/chats/dm/$USER_A/messages

echo "── ۱۰) مدیر دوم لیست کلاس‌های خودش (انتظار: 200 و لیست خالی)"
curl -s -b $JAR_B $BASE/api/classes | head -c 100; echo

echo "── ۱۱) دانش‌آموز مدرسه اول سعی در /api/users (انتظار: 403)"
JAR_S=/tmp/jar_student.txt; rm -f $JAR_S
curl -s -c $JAR_S -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"beheshti.s1","password":"Pass@123","realm":"app"}' > /dev/null
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_S $BASE/api/users

echo "── ۱۲) دانش‌آموز سعی در ایجاد کلاس (انتظار: 403)"
curl -s -o /dev/null -w "%{http_code}\n" -b $JAR_S -X POST $BASE/api/classes \
  -H 'Content-Type: application/json' -d '{"name":"کلاس جعلی"}'

echo "── ۱۳) ورود مدیر کل از مسیر اپ (انتظار: 403)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"superadmin","password":"Admin@1234","realm":"app"}'

echo "── ✔ پایان تست‌های جداسازی"
