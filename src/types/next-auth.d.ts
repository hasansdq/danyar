import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";
      username: string;
      schoolId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";
    username: string;
    schoolId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";
    username: string;
    schoolId?: string | null;
  }
}
