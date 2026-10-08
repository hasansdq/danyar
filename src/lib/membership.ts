import { db } from "@/lib/db";
import type { ClassMembership, ClassRoom, User } from "@prisma/client";

/**
 * Returns all ClassRooms the user is a member of, together with their
 * ClassMembership row (so callers can read the membership role: STUDENT/TEACHER).
 */
export async function getUserClasses(userId: string) {
  return db.classMembership.findMany({
    where: { userId },
    include: {
      class: true,
    },
    orderBy: {
      class: { name: "asc" },
    },
  });
}

/**
 * Returns the membership row if `userId` is a member of `classId`, else null.
 */
export async function verifyMembership(
  userId: string,
  classId: string,
): Promise<ClassMembership | null> {
  if (!classId) return null;
  return db.classMembership.findUnique({
    where: {
      classId_userId: { classId, userId },
    },
  });
}

/**
 * Returns true if `userId` is a TEACHER member of `classId`.
 */
export async function isTeacherOf(
  userId: string,
  classId: string,
): Promise<boolean> {
  const membership = await verifyMembership(userId, classId);
  return !!membership && membership.role === "TEACHER";
}

/**
 * Convenience: returns the membership row for the user in the class, throws
 * (with a flag) when the user is not a member. Callers in API routes can use
 * this to ensure authorization quickly.
 */
export async function requireMembership(
  userId: string,
  classId: string,
): Promise<ClassMembership> {
  const membership = await verifyMembership(userId, classId);
  if (!membership) {
    const err = new Error("FORBIDDEN");
    (err as any).code = "FORBIDDEN";
    throw err;
  }
  return membership;
}

export type MembershipWithClass = ClassMembership & {
  class: ClassRoom;
  user: User;
};
