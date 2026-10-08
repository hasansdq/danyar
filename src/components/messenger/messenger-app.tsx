"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Bot,
  GraduationCap,
  Menu,
  ArrowRight,
  BookOpen,
  FileQuestion,
  BarChart3,
  Bookmark,
  RefreshCw,
  Search,
  Users,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  CalendarCheck,
  FileText,
} from "lucide-react";
import { createDirectChat, fetchClasses, fetchDirectChats } from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "./user-menu";
import { ClassSelector } from "./class-selector";
import { ClassChat } from "./class-chat";
import { DirectChat } from "./direct-chat";
import { UserSearchDialog } from "./user-search-dialog";
import {
  ConversationList,
  type ConversationItem,
} from "./conversation-list";
import { AssignmentsView } from "./assignments-view";
import { SampleQuestionsView } from "./sample-questions-view";
import { GradesView } from "./grades-view";
import { SavedMessagesView } from "./saved-messages-view";
import { PullToRefresh } from "./pull-to-refresh";
import { ThemeToggle } from "@/components/theme-toggle";
import { useDeviceType } from "./use-device-type";
import { useCan } from "./use-permissions";
import { AIAssistantPanel } from "./ai-assistant-panel";
import { CreateMenu } from "./create-menu";
import { FloatingCreateButton } from "./floating-create-button";
import { AnnouncementsSheet } from "./announcements-sheet";
import { AttendanceView } from "./attendance-view";
import { StudentReportsView } from "./student-reports-view";
import type {
  ClassItem,
  DirectChat as DirectChatRec,
  DirectChatUser,
  MessengerUser,
} from "./types";

/**
 * Chat is now one of the conversation types the user can open from the
 * conversation list. The other class features (تکالیف, نمونه سوالات, نمرات)
 * live in the hamburger menu / mobile bottom nav and open in a Sheet when
 * selected. The "نمرات مثبت و منفی" (behavior) feature has been REMOVED
 * from the platform entirely (phase 11).
 */
type FeatureKey =
  | "assignments"
  | "questions"
  | "grades"
  | "saved"
  | "attendance"
  | "reports";

const MENU_FEATURES: Array<{
  key: FeatureKey;
  title: string;
  description: string;
  icon: typeof BookOpen;
  color: string;
}> = [
  {
    key: "assignments",
    title: "تکالیف",
    description: "تکالیف و تمرین‌های کلاس به همراه فایل‌های پیوست",
    icon: BookOpen,
    color: "bg-emerald-500/10 text-emerald-600",
  },
  {
    key: "questions",
    title: "نمونه سوالات",
    description: "نمونه سوالات امتحانی بارگذاری‌شده توسط استاد",
    icon: FileQuestion,
    color: "bg-teal-500/10 text-teal-600",
  },
  {
    key: "grades",
    title: "نمرات",
    description: "نمرات ثبت‌شده در این کلاس",
    icon: BarChart3,
    color: "bg-green-500/10 text-green-600",
  },
  {
    key: "saved",
    title: "پیام‌های ذخیره‌شده",
    description: "پیام‌هایی که ذخیره کرده‌اید",
    icon: Bookmark,
    color: "bg-amber-500/10 text-amber-600",
  },
];

/**
 * Mobile-student bottom nav tabs. For teachers on mobile + every role on
 * tablet/desktop, the hamburger menu is the canonical entry-point for
 * non-chat features. For STUDENTS on mobile, this fixed bottom nav
 * replaces the hamburger menu (a cleaner mobile UX for navigation).
 *
 * Phase 28 — STUDENTS get a "گزارشات" tab (FileText) that opens the
 * StudentReportsView (their own attendance absences + violations).
 * TEACHERS get a "حضور و غیاب" tab (CalendarCheck) that opens the
 * AttendanceView (taking attendance for their class). ADMINs already
 * have their own admin-tab variant further below.
 */
type MobileTab =
  | "groups"
  | "assignments"
  | "grades"
  | "questions"
  | "reports"
  | "attendance";

const MOBILE_TABS: Array<{
  key: MobileTab;
  label: string;
  icon: typeof Users;
  feature?: FeatureKey;
}> = [
  { key: "groups", label: "گروه‌ها", icon: Users },
  { key: "assignments", label: "تکالیف", icon: ClipboardList, feature: "assignments" },
  { key: "grades", label: "نمرات", icon: GraduationCap, feature: "grades" },
  { key: "questions", label: "نمونه‌سوال", icon: FileQuestion, feature: "questions" },
];

// STUDENT bottom nav — adds a "گزارشات" tab at the end.
const STUDENT_MOBILE_TABS: typeof MOBILE_TABS = [
  ...MOBILE_TABS,
  { key: "reports", label: "گزارشات", icon: FileText, feature: "reports" },
];

// TEACHER bottom nav — adds a "حضور و غیاب" tab at the end.
const TEACHER_MOBILE_TABS: typeof MOBILE_TABS = [
  ...MOBILE_TABS,
  { key: "attendance", label: "حضور و غیاب", icon: CalendarCheck, feature: "attendance" },
];

/**
 * Metadata for ANY openable feature — used by the Sheet header to render
 * the icon + title for the active feature. Includes the hamburger-only
 * MENU_FEATURES entries PLUS the bottom-nav-only "attendance" + "reports"
 * features (those aren't in the hamburger menu, but the Sheet header
 * still needs their icon/title when they're opened via the bottom nav).
 */
const FEATURE_META: Record<
  FeatureKey,
  { title: string; icon: typeof BookOpen; color: string }
> = {
  // Object.fromEntries loses the key literal types (it returns a string
  // index signature), so a double cast through `unknown` is required here.
  ...(Object.fromEntries(
    MENU_FEATURES.map((f) => [f.key, f]),
  ) as unknown as Record<
    FeatureKey,
    { title: string; icon: typeof BookOpen; color: string }
  >),
  attendance: {
    title: "حضور و غیاب",
    icon: CalendarCheck,
    color: "bg-emerald-500/10 text-emerald-600",
  },
  reports: {
    title: "گزارشات",
    icon: FileText,
    color: "bg-emerald-500/10 text-emerald-600",
  },
};

/** Combined lookup used by the hamburger menu — finds the bottom-nav tab
 *  that maps to a given FeatureKey (across student + teacher + admin tab
 *  lists). Returns the tab key so the bottom nav highlights the right
 *  tab when the user picks a feature from the hamburger menu. */
const FEATURE_TO_TAB: Partial<Record<FeatureKey, MobileTab>> = {
  assignments: "assignments",
  grades: "grades",
  questions: "questions",
  saved: "groups", // "saved" is a hamburger-only feature; collapse to groups.
  attendance: "attendance",
  reports: "reports",
};

/**
 * Mobile-ADMIN (principal) bottom nav tabs (phase 16). 4 tabs tailored
 * for the principal role:
 *   - گروه‌ها      → conversation list (default view)
 *   - پنل مدیریت   → deep-link to /admin (full management dashboard)
 *   - اطلاعیه‌ها   → opens the AnnouncementsSheet inline (Phase 24:
 *                   same content as the /admin/announcements page —
 *                   send-new + list of past announcements + delivery
 *                   stats. The old "ارسال پیام یکسان" bulk broadcast
 *                   has been removed).
 *   - دستیار      → opens the AI assistant Sheet (replaces the old
 *                   "گزارشات" tab — the AI assistant is now the primary
 *                   principal action reachable from the bottom nav).
 *
 * On desktop/tablet the principal uses the admin sidebar like everyone
 * else; this is ONLY for principals on mobile (mirrors the student
 * bottom-nav pattern, with principal-specific destinations).
 */
type AdminMobileTab =
  | "groups"
  | "admin_panel"
  | "announcements"
  | "assistant"
  | "attendance";

const ADMIN_MOBILE_TABS: Array<{
  key: AdminMobileTab;
  label: string;
  icon: typeof Users;
}> = [
  { key: "groups", label: "گروه‌ها", icon: MessageSquare },
  { key: "attendance", label: "حضور و غیاب", icon: CalendarCheck },
  { key: "admin_panel", label: "پنل مدیریت", icon: LayoutDashboard },
  { key: "announcements", label: "اطلاعیه‌ها", icon: Megaphone },
  { key: "assistant", label: "دستیار", icon: Bot },
];

/**
 * Main messenger client application.
 *
 * Layout (default = conversation list):
 *   ┌──────────────────────────────────────────────┐
 *   │ HEADER: [☰|search] [logo] [class-select▼] [me]│ (sticky)
 *   ├──────────────────────────────────────────────┤
 *   │  CONVERSATION LIST (scrollable, full-height) │
 *   │   · class row → opens ClassChat               │
 *   │   · DM row    → opens DirectChat              │
 *   ├──────────────────────────────────────────────┤
 *   │ BOTTOM NAV (mobile-students only — 4 tabs)   │
 *   └──────────────────────────────────────────────┘
 *
 * When a conversation is opened, the main area swaps to the chat view
 * (ClassChat/DirectChat) which has its own back button to return to the
 * conversation list.
 */
export function MessengerApp({ user }: { user: MessengerUser }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const device = useDeviceType();
  // Hard-nav to /admin when the principal taps the پنل مدیریت bottom-nav
  // tab. Lazily destructured so we don't pay the router cost on roles that
  // never bottom-nav navigate.
  const router = useRouter();

  // Read the optional `?classId=` deep-link param (used by the principal's
  // "ورود به گفتگو" button on /admin/bulk-chat to deep-link into a specific
  // class chat). `useSearchParams` requires this component to be wrapped
  // in a <Suspense> boundary — handled by the parent page (src/app/page.tsx).
  const searchParams = useSearchParams();
  const deepLinkedClassId = searchParams?.get("classId") ?? null;

  // ----- TanStack queries: classes + direct chats (merged into the conv list) -----
  const {
    data: classes,
    isLoading: classesLoading,
    isError: classesError,
    refetch: refetchClasses,
  } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    refetchOnMount: true,
  });

  const {
    data: directChats,
    isLoading: dmsLoading,
    refetch: refetchDms,
  } = useQuery<DirectChatRec[]>({
    queryKey: ["direct-chats", user.id],
    queryFn: () => fetchDirectChats(),
    refetchOnMount: true,
  });

  // ----- View state -----
  // `selectedClassId` is the class for the ClassChat view. NULL = no class
  // chat is open (we're in the conversation list, OR a DM is open, OR a
  // feature Sheet is open).
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [activeDirectChat, setActiveDirectChat] =
    useState<{ chatId: string; otherUser: DirectChatUser } | null>(null);
  const [openFeature, setOpenFeature] = useState<FeatureKey | null>(null);
  // ----- Phase 18 — announcements Sheet (ADMIN / principal only) -----
  // The principal can open the AnnouncementsSheet from the messenger
  // header's Megaphone button (next to the "+" create-menu) to:
  //   - Send a new announcement to one or more groups
  //   - Browse previously-sent announcements
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);

  // ----- AI assistant sheet (controlled state) -----
  // Phase 16 — the circular AI FAB is removed from the messenger header.
  // The Sheet itself stays mounted, opened by either:
  //   1. The mobile bottom-nav "دستیار" tab (ADMIN only), OR
  //   2. (Desktop/tablet principals still have access via the admin
  //      panel's admin-topbar which keeps its own AIAssistantButton.)
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  // The principal-only `ai_assistant` permission flag (default true while
  // the permissions query is still in flight — mirrors the AIAssistantButton
  // gating so the bottom-nav "دستیار" tab and the mounted Sheet stay
  // consistent with the admin-topbar FAB).
  const canUseAI = useCan("ai_assistant");

  // ----- User search dialog state (for starting a new DM) -----
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  // Tracks which sender id is being used to open a DM right now (in-flight
  // POST). The ClassChat MessageRow shows a spinner on that row.
  const [openingForUserId, setOpeningForUserId] = useState<string | null>(
    null,
  );

  // ----- Mobile-student bottom nav active tab -----
  // Drives which tab is highlighted. Default = "groups" (conversation list).
  // When a non-groups tab is selected, the matching feature Sheet is open.
  const [mobileTab, setMobileTab] = useState<MobileTab>("groups");
  // Mobile-ADMIN (principal) bottom nav active tab. Default = "groups".
  // The other three tabs deep-link to /admin or open the bulk-broadcast
  // Sheet — they don't change the messenger main view; they just navigate
  // away. The tab stays visually "active" while the user is in that
  // destination so they can resume back to "گروه‌ها" when they return
  // via the messenger header.
  const [adminMobileTab, setAdminMobileTab] =
    useState<AdminMobileTab>("groups");

  // Bottom-nav visibility — Phase 20: show the bottom nav on ALL screen
  // sizes (mobile + tablet + desktop), for ALL roles. The hamburger menu
  // stays visible too (for extra features like settings, search, etc.).
  const showStudentNav = user.role === "STUDENT";
  const showAdminNav = user.role === "ADMIN";
  const showTeacherNav = user.role === "TEACHER";
  const hasBottomNav = showStudentNav || showAdminNav || showTeacherNav;
  // Whether the user is currently inside a chat (class chat or DM).
  // When true: hide the main platform header, the footer, and the mobile
  // bottom nav so the chat gets full-screen space (only the chat's own
  // header + messages + input are visible). A "back" button in the chat
  // header returns to the conversation list.
  const isInChat = (!!selectedClassId || !!activeDirectChat) && !openFeature;
  // Derive the effective selected class: prefer the user's explicit
  // selection, then a deep-link (?classId=<id>) from /admin/bulk-chat, then
  // the first class as a fallback. Used by the feature Sheet (which needs
  // a class context even when the user hasn't picked one explicitly).
  const effectiveClassId = useMemo<string | null>(() => {
    if (!classes || classes.length === 0) return null;
    if (selectedClassId && classes.find((c) => c.id === selectedClassId)) {
      return selectedClassId;
    }
    if (deepLinkedClassId && classes.find((c) => c.id === deepLinkedClassId)) {
      return deepLinkedClassId;
    }
    return classes[0].id;
  }, [classes, selectedClassId, deepLinkedClassId]);

  const selectedClass =
    (classes ?? []).find((c) => c.id === effectiveClassId) ?? null;

  // membership role for the selected class — drives whether the
  // student/teacher UI is rendered.
  const isTeacherOfSelected =
    selectedClass?.role === "TEACHER" || user.role === "ADMIN";

  function handleRefetch() {
    void refetchClasses();
    void refetchDms();
    toast({
      title: "بارگذاری مجدد",
      description: "فهرست گفتگوها به‌روزرسانی شد.",
    });
  }
  // Phase 21 — pull-to-refresh handler (replaces the header reload button).
  async function refetchAll() {
    await Promise.all([refetchClasses(), refetchDms()]);
  }

  function openSearch() {
    setSearchInitialQuery("");
    setSearchOpen(true);
  }

  /**
   * Start (or open) a 1:1 direct chat with the given user. Used by both
   * the search dialog and the class-chat "click sender" affordance. On
   * 403 (DM permission denied by the principal's per-school toggles),
   * the server returns a Persian error message which we surface via toast.
   */
  async function startDirectChatWith(otherUser: DirectChatUser) {
    setOpeningForUserId(otherUser.id);
    try {
      const chat: DirectChatRec = await createDirectChat({
        userId: otherUser.id,
      });
      // Switch the main view from the conversation list to the DM. Clear
      // any open class chat / feature Sheet so the DM takes the full area.
      setSelectedClassId(null);
      setOpenFeature(null);
      setMobileTab("groups");
      setActiveDirectChat({
        chatId: chat.id,
        otherUser: chat.otherUser,
      });
      toast({
        title: "گفتگو خصوصی باز شد",
        description: `اکنون با ${otherUser.fullName} در یک گفتگو خصوصی هستید.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "آغاز گفتگو ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setOpeningForUserId(null);
    }
  }

  /** Convenience wrapper for the "click a sender" intent in ClassChat. */
  function handleStartDirectFromSender(otherUser: DirectChatUser) {
    void startDirectChatWith(otherUser);
  }

  /**
   * Handle a conversation-row click: open the matching chat view + close
   * any open feature Sheet + clear the other chat kind so only one chat
   * is open at a time.
   */
  function handleSelectConversation(item: ConversationItem) {
    setOpenFeature(null);
    if (item.kind === "class") {
      setActiveDirectChat(null);
      setSelectedClassId(item.id);
      setMobileTab("groups");
    } else {
      setSelectedClassId(null);
      setActiveDirectChat({ chatId: item.id, otherUser: item.otherUser });
      setMobileTab("groups");
    }
  }

  /**
   * Return to the conversation list (clears whichever chat is open).
   * Called by ClassChat's + DirectChat's back buttons. Also invalidates
   * the direct-chats query so the list reflects the latest readAt /
   * unread state when the user comes back to it.
   */
  function handleBackToConversationList() {
    setActiveDirectChat(null);
    setSelectedClassId(null);
    setOpenFeature(null);
    setMobileTab("groups");
    // Invalidate so the conversation list re-fetches fresh data
    // (last-message preview, unread count, read tick) instead of showing
    // the stale snapshot from before the chat was opened.
    void queryClient.invalidateQueries({ queryKey: ["direct-chats", user.id] });
    void queryClient.invalidateQueries({ queryKey: ["classes", user.id] });
  }

  /**
   * Mobile STUDENT bottom-nav tab click. Groups returns to the conversation
   * list; the other tabs open the matching feature Sheet (closing any open
   * chat so the Sheet is the focus).
   */
  function handleMobileTab(tab: MobileTab) {
    setMobileTab(tab);
    if (tab === "groups") {
      setActiveDirectChat(null);
      setSelectedClassId(null);
      setOpenFeature(null);
    } else {
      // Close the chat to give the feature Sheet full focus.
      setActiveDirectChat(null);
      setSelectedClassId(null);
      // Look up the feature for the tab across student + teacher tab
      // lists (so a student tab like "reports" resolves correctly even
      // though STUDENT_MOBILE_TABS is what we render for students).
      const allTabs = [...STUDENT_MOBILE_TABS, ...TEACHER_MOBILE_TABS];
      const feature = allTabs.find((t) => t.key === tab)?.feature;
      setOpenFeature(feature ?? null);
    }
  }

  /**
   * Mobile ADMIN (principal) bottom-nav tab click. Groups returns to the
   * conversation list. اطلاعیه‌ها opens the AnnouncementsSheet inline
   * (same content as the /admin/announcements page — send-new + list of
   * past announcements). دستیار opens the AI assistant Sheet inline
   * (phase 16). پنل مدیریت navigates away to /admin (the next-hard-nav
   * leaves this component's React tree).
   */
  function handleAdminMobileTab(tab: AdminMobileTab) {
    setAdminMobileTab(tab);
    if (tab === "groups") {
      setActiveDirectChat(null);
      setSelectedClassId(null);
      setOpenFeature(null);
    } else if (tab === "announcements") {
      // Open the AnnouncementsSheet (in-place) — same UI as the
      // /admin/announcements page. The "ارسال پیام یکسان" bulk broadcast
      // feature has been removed (Phase 24); the AnnouncementsSheet is
      // now the sole principal broadcast UI in the messenger.
      setActiveDirectChat(null);
      setSelectedClassId(null);
      setOpenFeature(null);
      setAnnouncementsOpen(true);
    } else if (tab === "assistant") {
      // Open the AI assistant Sheet (in-place). Don't close an open chat —
      // the Sheet is a side panel that overlays whatever is on the main
      // area; closing the chat would force the user back to the conv list
      // when they dismiss the Sheet.
      setAiPanelOpen(true);
    } else if (tab === "attendance") {
      // Phase 28 — opens the AttendanceView Sheet (principal takes
      // attendance for any of their classes). Same flow as a student
      // tab → openFeature Sheet.
      setActiveDirectChat(null);
      setSelectedClassId(null);
      setOpenFeature("attendance");
    } else {
      // پنل مدیریت → leave the messenger for /admin (the admin layout
      // has its own sidebar; we hard-nav so the next-page header / footer
      // take over).
      router.push("/admin");
    }
  }

  function renderFeatureContent() {
    // "saved" doesn't need a class context — it shows messages from all chats.
    if (openFeature === "saved") {
      return <SavedMessagesView />;
    }
    // Phase 28 — attendance + reports don't need a class context.
    //   - AttendanceView has its own class selector (teacher/admin can
    //     pick any of their classes from inside the view).
    //   - StudentReportsView fetches the caller's own attendance rows
    //     across ALL their classes — no class context needed.
    if (openFeature === "attendance") {
      return <AttendanceView />;
    }
    if (openFeature === "reports") {
      return <StudentReportsView />;
    }
    // Fall back to the effective (first-available) class so the Sheet has
    // a class context even when the user hasn't explicitly picked one.
    const cls = selectedClass ?? null;
    if (!cls) return null;
    switch (openFeature) {
      case "assignments":
        return (
          <AssignmentsView
            classId={cls.id}
            isTeacher={isTeacherOfSelected}
            user={user}
          />
        );
      case "questions":
        return (
          <SampleQuestionsView
            classId={cls.id}
            isTeacher={isTeacherOfSelected}
            user={user}
          />
        );
      case "grades":
        return (
          <GradesView
            classId={cls.id}
            currentUserId={user.id}
            isTeacher={isTeacherOfSelected}
          />
        );
      default:
        return null;
    }
  }

  // The active feature metadata (for the Sheet header).
  const activeFeature = openFeature ? FEATURE_META[openFeature] : null;

  // ----- Main-area rendering branches -----
  // Priority: feature Sheet (when open) > active DM > selected class chat
  // > conversation list. The conversation list is the DEFAULT view when
  // nothing else is active.
  function renderMain() {
    // Error from classes query → show retry UI.
    if (classesError) {
      return (
        <Card className="m-auto max-w-md">
          <CardContent className="py-10 text-center">
            <Inbox className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 font-medium">
              بارگذاری گفتگوها ناموفق بود
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              لطفاً مجدداً تلاش کنید.
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void refetchClasses()}
            >
              <RefreshCw className="size-4" />
              بارگذاری مجدد
            </Button>
          </CardContent>
        </Card>
      );
    }

    // Loading either source AND no items yet → skeletons.
    const itemsReady =
      !classesLoading && !dmsLoading && (classes?.length || 0) >= 0;
    const nothingOpenYet =
      !activeDirectChat && !selectedClassId && !openFeature;

    if (nothingOpenYet) {
      // Conversation list = default home view.
      return (
        <ConversationList
          user={user}
          classes={classes ?? []}
          classesLoading={classesLoading}
          classesError={classesError}
          dms={directChats ?? []}
          dmsLoading={dmsLoading}
          onRetryClasses={() => void refetchClasses()}
          onOpenSearch={openSearch}
          onSelectConversation={handleSelectConversation}
          
        />
      );
    }

    if (!itemsReady && (activeDirectChat || selectedClassId)) {
      // A chat is opening but the source data is still loading — keep the
      // user informed with a skeleton instead of an empty flash.
      return (
        <div className="m-auto w-full max-w-md space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <LazySkeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      );
    }

    // 1) Active DM takes priority.
    if (activeDirectChat) {
      return (
        <DirectChat
          user={user}
          chatId={activeDirectChat.chatId}
          otherUser={activeDirectChat.otherUser}
          onBack={handleBackToConversationList}
        />
      );
    }

    // 2) Active class chat.
    if (selectedClassId && selectedClass) {
      return (
        <ClassChat
          user={user}
          classId={selectedClass.id}
          className={selectedClass.name}
          initialChatClosed={selectedClass.chatClosed ?? false}
          fileSettings={{
            fileUploadEnabled: selectedClass.fileUploadEnabled,
            maxFileSizeMb: selectedClass.maxFileSizeMb,
            allowedFileTypes: selectedClass.allowedFileTypes,
          }}
          openingForUserId={openingForUserId}
          onStartDirectChat={handleStartDirectFromSender}
          onBack={handleBackToConversationList}
          // Phase 19 — wire the linked-card "مشاهده تکلیف" / "مشاهده نمونه
          // سوال" buttons to open the matching feature Sheet. The Sheet
          // uses the current `selectedClass` context (we DON'T clear
          // `selectedClassId` so the chat stays as the parent context).
          // When the user dismisses the Sheet, they return to this chat.
          onOpenAssignment={() => setOpenFeature("assignments")}
          onOpenSampleQuestion={() => setOpenFeature("questions")}
        />
      );
    }

    // 3) No chat and no classes (user is in 0 classes + no DMs yet) —
    // show the conversation list anyway (it has a proper empty-state
    // encouraging them to search for a user).
    return (
      <ConversationList
        user={user}
        classes={classes ?? []}
        classesLoading={classesLoading}
        classesError={classesError}
        dms={directChats ?? []}
        dmsLoading={dmsLoading}
        onRetryClasses={() => void refetchClasses()}
        onOpenSearch={openSearch}
        onSelectConversation={handleSelectConversation}
        
      />
    );
  }

  // Bottom nav height = 56px (h-14). Main area needs this much bottom
  // padding so the bottom nav doesn't cover the chat input. Applies to
  // BOTH mobile-students AND mobile-admins (principals) — either role's
  // bottom nav sits at fixed bottom-0 and would otherwise overlap the
  // chat input / class-chat content.
  const bottomNavPad = hasBottomNav && !isInChat ? "pb-14" : "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ---------- HEADER (sticky) ----------
          HIDDEN when inside a chat (isInChat) — the chat's own header
          (with back button + class/user name + chat actions) replaces
          the platform header for a cleaner full-screen chat experience. */}
      {!isInChat ? (
        // Phase 28 — standalone features (attendance, reports) get a
        // MINIMAL header (back button + title + theme + user menu only)
        // to avoid icon overlap on mobile.
        (openFeature === "attendance" || openFeature === "reports") ? (
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-3 py-2.5">
              {/* Back button (visually right in RTL) */}
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={handleBackToConversationList}
                aria-label="بازگشت"
                title="بازگشت به گفتگوها"
              >
                <ArrowRight className="size-5" />
              </Button>
              {/* Title */}
              <span className="flex-1 truncate text-center text-sm font-semibold">
                {openFeature === "attendance" ? "حضور و غیاب" : "گزارش‌های من"}
              </span>
              {/* Theme + user menu (visually left in RTL) */}
              <ThemeToggle className="size-9 shrink-0" />
              <UserMenu user={user} />
            </div>
          </header>
        ) :
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          {/* Hamburger menu (visually right in RTL) — holds the non-chat
              features. HIDDEN for mobile-students AND mobile-admins
              (principals) — both roles use the bottom nav for navigation
              instead. Visible for: teachers on mobile, everyone on
              tablet/desktop. */}
          {true ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="منوی امکانات کلاس"
                  title="امکانات کلاس"
                  className="size-9 shrink-0"
                >
                  <Menu className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-64"
                collisionPadding={8}
              >
                <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                  امکانات کلاس
                  {selectedClass ? (
                    <span className="truncate font-normal">
                      · {selectedClass.name}
                    </span>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {MENU_FEATURES.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <DropdownMenuItem
                      key={feature.key}
                      onSelect={() => {
                        setOpenFeature(feature.key);
                        // Closing any open chat so the Sheet has focus.
                        setActiveDirectChat(null);
                        setSelectedClassId(null);
                        setMobileTab(
                          FEATURE_TO_TAB[feature.key] ?? "groups",
                        );
                      }}
                      className="gap-3 py-2.5"
                      disabled={!selectedClass}
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${feature.color}`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="flex flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium leading-tight">
                          {feature.title}
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-tight">
                          {feature.description}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {/* logo + title */}
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl shadow-sm">
              <GraduationCap className="size-5" />
            </div>
            <div className="hidden flex-col sm:flex">
              <span className="text-lg font-bold leading-tight">
                دانیار
              </span>
              {user.schoolName ? (
                <span className="text-xs text-muted-foreground leading-tight">
                  {user.schoolName}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground leading-tight">
                  سامانه آموزشی
                </span>
              )}
            </div>
          </div>

          <Separator orientation="vertical" className="mx-1 hidden h-8 sm:block" />

          {/* Class selector — quick-jump dropdown for desktop/tablet.
              Hidden on mobile (the conversation list serves as the class
              picker there). Visible on sm+. */}
          <div className="hidden flex-1 items-center justify-center sm:flex">
            {classesLoading ? (
              <LazySkeleton className="h-9 w-[200px] sm:w-[220px]" />
            ) : (
              <ClassSelector
                classes={classes ?? []}
                selectedClassId={effectiveClassId}
                onChange={(id) => {
                  // Quick-jump to the class chat (replaces any open chat
                  // or feature sheet).
                  setOpenFeature(null);
                  setActiveDirectChat(null);
                  setSelectedClassId(id);
                  setMobileTab("groups");
                }}
                disabled={classesLoading}
              />
            )}
          </div>

          {/* Spacer for mobile (where the class selector is hidden). */}
          <div className="flex-1 sm:hidden" />

          {/* user menu + actions (visually left in RTL) */}
          <div className="flex items-center gap-1">
            {/* Phase 27 — the "+" create menu has been MOVED from the
                header to a Floating Action Button (FAB) at the bottom
                corner of the screen. See <FloatingCreateButton> mounted
                below the <main> element. The FAB has smart scroll
                hide/show behavior + an expandable menu (Telegram pattern). */}
            {/* Phase 18 — the "اطلاعیه‌ها" (announcements) button. ADMIN /
                principal only. Opens a Sheet showing the list of past
                announcements + a send-new form that can target MULTIPLE
                specific groups (vs. the bulk-chat button which broadcasts
                to ALL the principal's classes at once). */}
            {user.role === "ADMIN" ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setAnnouncementsOpen(true)}
                className="size-9 shrink-0"
                aria-label="اطلاعیه‌ها"
                title="مدیریت اطلاعیه‌ها"
              >
                <Megaphone className="size-4" />
              </Button>
            ) : null}
            {/* Phase 19 — the "مدیریت گفتگوها" (MessagesSquare) button has
                been REMOVED from the messenger header for ALL roles. In
                Phase 24 the BulkChatDialog (and its "ارسال پیام یکسان"
                broadcast) was also removed entirely — the AnnouncementsSheet
                above is now the principal's sole broadcast UI in the
                messenger, reachable from both the header Megaphone button
                AND the mobile-admin bottom-nav اطلاعیه‌ها tab. */}
            {/* Search icon — opens the user-search dialog so the user can
                start a 1:1 private chat by typing a name. Visible to ALL
                roles (the backend enforces per-school DM-permission toggles
                and returns 403 + a Persian error when denied). */}
            <Button
              variant="ghost"
              size="icon"
              onClick={openSearch}
              className="size-9 shrink-0"
              aria-label="جستجوی کاربران"
              title="جستجوی کاربران و آغاز گفتگو خصوصی"
            >
              <Search className="size-4" />
            </Button>
            {/* Phase 21 — reload button removed; pull-to-refresh replaces it */}
            <ThemeToggle className="size-9 shrink-0" />
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      ) : null}

      {/* ---------- MAIN ---------- */}
      <main
        className={cn(
          "mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col overflow-hidden px-0 sm:px-4 sm:py-2",
          bottomNavPad,
        )}
      >
        {!isInChat && !openFeature ? (
          <PullToRefresh
            onRefresh={() => void refetchAll()}
            className="flex-1"
          >
            {renderMain()}
          </PullToRefresh>
        ) : (
          renderMain()
        )}
      </main>

      {/* ---------- FLOATING CREATE BUTTON (Phase 27) ----------
          A circular FAB in the bottom corner that replaces the header
          "+" create-menu button. Has smart scroll hide/show behavior +
          an expandable menu (Telegram pattern). Hidden when the user is
          inside a chat (the chat's composer is at the bottom). */}
      <FloatingCreateButton
        user={user}
        currentClassId={effectiveClassId}
        onOpenGrades={() => setOpenFeature("grades")}
        hidden={isInChat || !!openFeature}
      />

      {/* ---------- FOOTER (mt-auto, sticks to bottom) ----------
          HIDDEN on mobile-roles-with-a-bottom-nav (students + admins /
          principals) — the bottom nav replaces the footer visually (both
          occupy the bottom of the viewport). */}
      {!hasBottomNav && !isInChat ? (
        <footer className="mt-auto border-t bg-secondary/40">
          <div className="mx-auto w-full max-w-5xl px-4 py-2 text-center text-[11px] text-muted-foreground">
            دانیار · سامانه آموزشی مدارس ·©{" "}
            {new Intl.DateTimeFormat("fa-IR", { year: "numeric" }).format(new Date())}
          </div>
        </footer>
      ) : null}

      {/* ---------- MOBILE STUDENT/TEACHER BOTTOM NAV (fixed) ----------
          Replaces the hamburger menu for STUDENTS and TEACHERS on mobile.
          4 tabs: گروه‌ها / تکالیف / نمرات / نمونه‌سوال. Phase 19 — teachers
          on mobile now share the SAME bottom nav as students (previously
          teachers had no bottom nav and had to use the hamburger menu).
          Principals have their OWN bottom nav rendered further below. */}
      {(showStudentNav || showTeacherNav) && !isInChat ? (
        <nav
          aria-label="ناوبری موبایل"
          className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex h-14 max-w-5xl items-stretch justify-around px-1">
            {(showStudentNav ? STUDENT_MOBILE_TABS : TEACHER_MOBILE_TABS).map((tab) => {
              const Icon = tab.icon;
              const isActive = mobileTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleMobileTab(tab.key)}
                  aria-label={tab.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      isActive && "text-primary",
                    )}
                  />
                  <span className="leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      {/* ---------- MOBILE ADMIN (PRINCIPAL) BOTTOM NAV (fixed) ----------
          Phase 16 — replaces the hamburger menu for principals on mobile.
          4 tabs: گروه‌ها / پنل مدیریت / اطلاعیه‌ها / دستیار.
          - گروه‌ها returns to the conversation list.
          - اطلاعیه‌ها opens the bulk-chat broadcast Sheet.
          - پنل مدیریت hard-navs to /admin (the admin dashboard has its
            own layout + sidebar).
          - دستیار opens the AI assistant Sheet inline (phase 16 —
            replaces the old "گزارشات" tab). */}
      {showAdminNav && !isInChat ? (
        <nav
          aria-label="ناوبری موبایل مدیر"
          className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex h-14 max-w-5xl items-stretch justify-around px-1">
            {ADMIN_MOBILE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = adminMobileTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleAdminMobileTab(tab.key)}
                  aria-label={tab.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      isActive && "text-primary",
                    )}
                  />
                  <span className="leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      {/* ---------- AI ASSISTANT SHEET (principal only — controlled) ----------
          Phase 16 — the circular AI FAB is REMOVED from the messenger.
          The Sheet itself stays mounted here, opened by:
            - the mobile bottom-nav "دستیار" tab (ADMIN only) —
              `setAiPanelOpen(true)`.
            - OR via the admin panel's admin-topbar which keeps its own
              AIAssistantButton (the FAB stays for /admin pages).
          The eligibility check matches the FAB's gating (ADMIN role +
          `ai_assistant` permission flag) so students/teachers never see
          the Sheet. */}
      {user.role === "ADMIN" && canUseAI ? (
        <AIAssistantPanel open={aiPanelOpen} onOpenChange={setAiPanelOpen} />
      ) : null}

      {/* ---------- FEATURE SHEET (opened from hamburger menu / bottom nav) ---------- */}
      <Sheet
        open={openFeature !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenFeature(null);
            setMobileTab("groups");
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="border-b bg-background px-4 py-3">
            <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
              {activeFeature
                ? (() => {
                    const Icon = activeFeature.icon;
                    return (
                      <>
                        <span
                          className={`flex size-7 items-center justify-center rounded-md ${activeFeature.color}`}
                        >
                          <Icon className="size-4" />
                        </span>
                        {activeFeature.title}
                      </>
                    );
                  })()
                : null}
              {/* Phase 28 — attendance + reports don't take a class context
                  (they have their own class selectors / span all classes).
                  Hide the "· {className}" suffix in the Sheet header for
                  those features so the title doesn't get a misleading
                  class-name chip attached. */}
              {selectedClass &&
              openFeature !== "attendance" &&
              openFeature !== "reports" ? (
                <span className="text-muted-foreground text-xs font-normal">
                  · {selectedClass.name}
                </span>
              ) : null}
            </SheetTitle>
            {/* Mobile-only compact class selector inside the Sheet header
                (the header class selector is hidden on mobile, so users
                need a way to switch the class for the feature).
                Phase 28 — attendance + reports have their own class
                selectors (or no class selector) inside the view, so the
                header class selector is hidden for those features. */}
            <div className="mt-2 sm:hidden">
              {classes &&
              classes.length > 0 &&
              openFeature !== "attendance" &&
              openFeature !== "reports" ? (
                <ClassSelector
                  classes={classes}
                  selectedClassId={effectiveClassId}
                  onChange={setSelectedClassId}
                />
              ) : null}
            </div>
            <SheetDescription className="sr-only">
              محتوای ویژگی انتخاب‌شده
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderFeatureContent()}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------- ANNOUNCEMENTS SHEET (phase 18 — principal only) ----------
          Opened by the header Megaphone button (next to "+") AND by the
          mobile-admin bottom-nav اطلاعیه‌ها tab (Phase 24). Lets the
          principal send a new announcement to ONE OR MORE specific groups
          (multi-select chips) and browse the list of past announcements
          with delivery / read stats. The old BulkChatDialog (which had a
          "ارسال پیام یکسان" broadcast card) was removed in Phase 24 —
          this Sheet is now the sole principal broadcast UI. */}
      {user.role === "ADMIN" ? (
        <AnnouncementsSheet
          open={announcementsOpen}
          onOpenChange={setAnnouncementsOpen}
          user={user}
        />
      ) : null}

      {/* ---------- USER SEARCH DIALOG (all roles) ----------
          Opened by the header search icon. On a successful
          POST /api/direct-chats, hands the resulting DirectChat back so
          the messenger can swap the conversation list for the direct chat view. */}
      <UserSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onDirectChatStarted={(chat) => {
          // Swap to the DM view immediately.
          setOpenFeature(null);
          setSelectedClassId(null);
          setMobileTab("groups");
          setActiveDirectChat({
            chatId: chat.id,
            otherUser: chat.otherUser,
          });
          // Invalidate the direct-chats query so the new DM shows up in
          // the conversation list when the user goes back to it.
          void queryClient.invalidateQueries({
            queryKey: ["direct-chats", user.id],
          });
        }}
        initialQuery={searchInitialQuery}
      />
    </div>
  );
}
