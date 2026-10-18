import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'

/** آمار داشبورد بر اساس نقش کاربر */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const uid = session.uid
  const schoolId = session.schoolId

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  })

  // آمار مدرسه برای مدیر و معاون — معاون همان هشت کارت هاب مدیریت مدرسه را می‌بیند
  // (آیکون‌های هر کارت بر اساس مجوزهایش در سطح صفحه فیلتر می‌شوند)
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') {
    const [
      classCount,
      groupCount,
      teacherCount,
      studentCount,
      viceCount,
      liveCount,
      pushSubs,
      annRows,
      lessonCount,
    ] = await Promise.all([
      db.classroom.count({ where: { schoolId } }),
      db.subjectGroup.count({ where: { classroom: { schoolId } } }),
      db.user.count({ where: { schoolId, role: 'TEACHER' } }),
      db.user.count({ where: { schoolId, role: 'STUDENT' } }),
      db.user.count({ where: { schoolId, role: 'SCHOOL_VICE' } }),
      db.liveSession.count({ where: { classroom: { schoolId }, status: 'ACTIVE' } }),
      db.pushSubscription.count({ where: { user: { schoolId } } }),
      db.message.findMany({
        where: {
          isAnnouncement: true,
          deletedAt: null,
          subjectGroup: { classroom: { schoolId } },
        },
        select: { senderId: true, body: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // درس‌های تعریف‌شدهٔ مدرسه (درخواست کاربر — باکس «درس‌ها»)
      db.lesson.count({ where: { schoolId } }),
    ])

    // هر اطلاعیه برای هر گروه هدف یک کپی پیام ایجاد می‌کند؛ رویدادهای تکراری
    // (فرستنده + متن + بازه ۱۰ ثانیه‌ای) به‌عنوان یک اطلاعیه شمرده می‌شوند
    let announcementCount = 0
    let last: { senderId: string; body: string; at: number } | null = null
    for (const m of annRows) {
      const t = m.createdAt.getTime()
      if (last && last.senderId === m.senderId && last.body === m.body && Math.abs(t - last.at) <= 10_000) {
        continue
      }
      announcementCount++
      last = { senderId: m.senderId, body: m.body, at: t }
    }

    const classrooms = await db.classroom.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'asc' },
      take: 8,
      include: {
        _count: { select: { subjectGroups: true, enrollments: true } },
      },
    })

    return NextResponse.json({
      role: session.role,
      schoolName: school?.name ?? '',
      stats: [
        { key: 'classes', label: 'کلاس‌ها', value: classCount },
        { key: 'groups', label: 'گروه‌های درسی', value: groupCount },
        { key: 'teachers', label: 'معلمان', value: teacherCount },
        { key: 'deputies', label: 'معاونین', value: viceCount },
        { key: 'students', label: 'دانش‌آموزان', value: studentCount },
        { key: 'lessons', label: 'درس‌ها', value: lessonCount },
        { key: 'announcements', label: 'اطلاعیه‌ها', value: announcementCount },
        { key: 'onlineClasses', label: 'کلاس‌های آنلاین', value: liveCount },
        { key: 'notifications', label: 'اعلان‌ها', value: pushSubs },
      ],
      classrooms,
    })
  }

  if (session.role === 'TEACHER') {
    const groups = await db.subjectGroup.findMany({
      where: { teachingAssignments: { some: { teacherId: uid } } },
      orderBy: { createdAt: 'asc' },
      include: {
        classroom: { select: { name: true } },
        _count: {
          select: {
            teachingAssignments: true,
            messages: true,
          },
        },
      },
    })

    // تعداد دانش‌آموزان هر گروه از طریق ثبت‌نام در کلاس
    const groupCards = await Promise.all(
      groups.map(async (g) => {
        const studentCount = g.classroomId
          ? await db.classroomEnrollment.count({
              where: { classroomId: g.classroomId },
            })
          : 0
        const lastMessage = await db.message.findFirst({
          where: { subjectGroupId: g.id, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
        return {
          id: g.id,
          name: g.name,
          className: g.classroom?.name ?? 'گروه بدون کلاس',
          studentCount,
          messageCount: g._count.messages,
          lastActivity: lastMessage?.createdAt ?? null,
        }
      }),
    )

    const unreadDm = await db.message.count({
      where: { recipientId: uid, readAt: null, deletedAt: null },
    })

    return NextResponse.json({
      role: 'TEACHER',
      schoolName: school?.name ?? '',
      stats: [
        { key: 'groups', label: 'گروه‌های درسی من', value: groups.length },
        {
          key: 'students',
          label: 'دانش‌آموزان (مجموع کلاس‌ها)',
          value: new Set(groups.map((g) => g.classroomId)).size,
        },
        { key: 'unread', label: 'پیام‌های خوانده‌نشده خصوصی', value: unreadDm },
      ],
      groups: groupCards,
    })
  }

  // STUDENT
  const enrollments = await db.classroomEnrollment.findMany({
    where: { studentId: uid },
    include: {
      classroom: {
        include: {
          subjectGroups: {
            orderBy: { createdAt: 'asc' },
            include: {
              teachingAssignments: {
                select: { teacher: { select: { fullName: true } } },
              },
            },
          },
        },
      },
    },
  })

  const unreadDm = await db.message.count({
    where: { recipientId: uid, readAt: null, deletedAt: null },
  })

  const classes = enrollments.map((e) => ({
    id: e.classroom.id,
    name: e.classroom.name,
    groups: e.classroom.subjectGroups.map((g) => ({
      id: g.id,
      name: g.name,
      teachers: g.teachingAssignments.map((t) => t.teacher.fullName),
    })),
  }))

  const totalGroups = classes.reduce((sum, c) => sum + c.groups.length, 0)

  return NextResponse.json({
    role: 'STUDENT',
    schoolName: school?.name ?? '',
    stats: [
      { key: 'classes', label: 'کلاس‌های من', value: classes.length },
      { key: 'groups', label: 'گروه‌های درسی', value: totalGroups },
      { key: 'unread', label: 'پیام‌های خوانده‌نشده خصوصی', value: unreadDm },
    ],
    classes,
  })
}
