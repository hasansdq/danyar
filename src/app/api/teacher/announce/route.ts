import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { isTeacherOf } from "@/lib/membership";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";
import { sendNotificationToUser } from "@/lib/push-notifications";
import { getActiveProvider } from "@/lib/sms/provider-config";
import { logDelivery } from "@/lib/sms/delivery-log";
import { normalizePhone } from "@/lib/sms/otp";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/announce
 *
 * Creates announcement messages (isAnnouncement=true) in one or more classes.
 * Accepts multipart/form-data:
 *   - content (string, required — the announcement text)
 *   - classIds (string[] — repeated form field or comma-separated)
 *   - file (optional File)
 *   - sendSMS (string "true" | "false" — optional, default "false")
 *
 * Phase 36k — when sendSMS=true, the announcement is also sent as an SMS
 * to all class members who have a phone number (using the configured
 * SMS provider). SMS sending is non-blocking + failures are non-fatal.
 *
 * The principal (ADMIN) can announce to any class in their school.
 * Teachers can announce to classes they teach.
 * SUPERADMIN can announce to any class.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  await assertModule(user.role, "class_chat");
  if (user.role !== "TEACHER" && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "فقط معلم، مدیر یا مدیر کل می‌تواند اطلاعیه ارسال کند" },
      { status: 403 },
    );
  }

  const formData = await req.formData();
  const content = (formData.get("content") as string | null)?.trim() ?? "";
  // classIds can be repeated fields or a single comma-separated field
  const classIdsRaw = formData.getAll("classIds");
  const classIds = classIdsRaw
    .flatMap((v) => String(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  // Phase 36k — optional sendSMS flag.
  const sendSMSFlag = (formData.get("sendSMS") as string | null)?.toLowerCase() === "true";

  if (!content) {
    return badRequest("متن اطلاعیه نمی‌تواند خالی باشد");
  }
  // SECURITY (resource abuse): cap the announcement text length — mirrors
  // the /api/messages POST limit.
  if (content.length > 2000) {
    return badRequest("متن اطلاعیه نمی‌تواند بیش از ۲۰۰۰ کاراکتر باشد");
  }
  if (classIds.length === 0) {
    return badRequest("حداقل یک کلاس را انتخاب کنید");
  }

  // Optional file
  const file = formData.get("file") as File | null;
  let fileInfo: {
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    mimeType: string;
  } | null = null;

  if (file && file.size > 0) {
    const uploaded = await saveFormDataFile(file, { actorId: user.id });
    if (uploaded) {
      const cat = uploaded.mimeType?.startsWith("image/")
        ? "image"
        : uploaded.mimeType === "application/pdf"
          ? "pdf"
          : uploaded.mimeType?.startsWith("video/")
            ? "video"
            : "file";
      fileInfo = {
        fileUrl: uploaded.fileUrl,
        fileName: uploaded.originalName,
        fileType: cat,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType || "",
      };
    }
  }

  // Verify access to each class + create announcement messages
  const results: { id: string; classId: string }[] = [];

  for (const classId of classIds) {
    // Access check
    if (user.role === "SUPERADMIN") {
      // ok
    } else if (user.role === "ADMIN") {
      const cls = await db.classRoom.findUnique({
        where: { id: classId },
        select: { schoolId: true },
      });
      if (!cls || cls.schoolId !== user.schoolId) {
        continue; // skip classes not in the principal's school
      }
    } else {
      // TEACHER
      const ok = await isTeacherOf(user.id, classId);
      if (!ok) continue;
    }

    const msg = await db.message.create({
      data: {
        classId,
        senderId: user.id,
        content,
        isAnnouncement: true,
        ...fileInfo,
      },
    });
    results.push({ id: msg.id, classId });

    // Phase 22 — send push notifications to all class members (except sender)
    try {
      const members = await db.classMembership.findMany({
        where: { classId, userId: { not: user.id } },
        select: { userId: true },
      });
      const cls = await db.classRoom.findUnique({
        where: { id: classId },
        select: { name: true },
      });
      for (const m of members) {
        await sendNotificationToUser(m.userId, {
          title: "📢 اطلاعیه جدید",
          body: content.substring(0, 100),
          url: `/?classId=${classId}`,
          tag: "announcement",
        });
      }
    } catch { /* push failure is non-fatal */ }

    // Phase 37 — send announcement as SMS to class members with a phone.
    // Only runs when sendSMS=true AND the active provider supports plain
    // text SMS (managed OTP-only services such as OTPy don't).
    if (sendSMSFlag) {
      try {
        const { adapter } = await getActiveProvider();
        if (adapter?.sendSms) {
          // Fetch members with their phone numbers (via User join).
          const membersWithPhones = await db.classMembership.findMany({
            where: { classId, userId: { not: user.id } },
            select: {
              user: { select: { phone: true } },
            },
          });
          const smsText = `اطلاعیه: ${content.substring(0, 200)}`;
          let smsSent = 0;
          for (const m of membersWithPhones) {
            const phone = m.user?.phone;
            if (!phone) continue;
            const normalized = normalizePhone(phone);
            const startedAt = Date.now();
            const result = await adapter.sendSms(normalized, smsText);
            if (result.ok) smsSent++;
            await logDelivery({
              provider: adapter.id,
              phone: normalized,
              purpose: "announcement",
              ok: result.ok,
              messageId: result.messageId,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
              latencyMs: Date.now() - startedAt,
            });
          }
          console.log(`[sms] announcement SMS sent to ${smsSent}/${membersWithPhones.length} members of class ${classId}`);
        }
      } catch (err) {
        console.error("[sms] announcement SMS failed:", err);
        // SMS failure is non-fatal — the announcement is still created.
      }
    }
  }

  return NextResponse.json({
    data: {
      count: results.length,
      messages: results,
    },
  });
});
