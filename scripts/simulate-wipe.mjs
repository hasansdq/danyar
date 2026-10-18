// شبیه‌سازی «اژدهای سندباکس»: پاک‌کردن همهٔ ردیف‌ها (شِما سالم می‌ماند) — فقط برای تست خودترمیمی
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
for (const m of ["aiMessage","aiConversation","aiUsageLog","aiSchoolSetting","pushDelivery","pushSubscription","impersonationLog","bulkSendLog","sampleQuestionBookmark","sampleQuestionFile","sampleQuestionClass","sampleQuestion","assignmentSubmission","assignment","attendanceEditLog","attendanceRecord","attendanceSession","studentGrade","studentViolation","liveChatMessage","liveParticipantLog","liveSession","classEvent","teacherLesson","lesson","notification","notificationPref","mutedChat","vicePermission","message","groupReadState","groupMemberOverride","classroomEnrollment","teachingAssignment","subjectGroup","classroom","upload","smsSendLog","user","school"]) {
  try { await db[m].deleteMany(); } catch (e) { console.log("skip", m, e.code); }
}
console.log("WIPED — users:", await db.user.count(), "schools:", await db.school.count());
await db.$disconnect();
