export interface ChatUser {
  id: string
  fullName: string
  role: string
}

export interface ChatMessage {
  id: string
  kind: 'GROUP' | 'DIRECT'
  subjectGroupId?: string | null
  recipientId?: string | null
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' | 'ANNOUNCEMENT' | 'ASSIGNMENT' | 'LIVE_INVITE' | 'SAMPLEQ'
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  readAt: string | null
  isAnnouncement: boolean
  assignmentId?: string | null
  liveSessionId?: string | null
  sampleQuestionId?: string | null
  clientId: string | null
  isForwarded?: boolean
  forwardedFromName?: string | null
  pinnedAt?: string | null
  /** عنوان تکلیف/نمونه‌سؤال مرتبط (برای نوار سنجاق و جست‌وجو) */
  refTitle?: string | null
  sender: ChatUser
  replyTo: {
    id: string
    body: string
    type: string
    deletedAt: boolean
    senderName: string
  } | null
  attachment: {
    url: string
    name: string
    mime: string
    size: number
    /** فقط AUDIO: مدت‌زمان بر حسب ثانیه */
    duration?: number | null
    /** فقط AUDIO: نمونه‌های موج صوتی (۰ تا ۱) */
    waveform?: number[] | null
  } | null
  status?: 'sending' | 'failed'
}

export interface LastMessageInfo {
  preview: string
  at: string
  senderName: string
  mine: boolean
  read?: boolean
}

export interface Conversation {
  key: string
  type: 'GROUP' | 'DM' | 'ASSISTANT'
  id: string
  title: string
  subtitle: string
  teachers?: string[]
  archived?: boolean
  policy?: string
  unread: number
  lastMessage: LastMessageInfo | null
}

export interface ConversationMeta {
  key: string
  type: 'GROUP' | 'DM'
  id: string
  title: string
  subtitle: string
  policy?: string
  archived?: boolean
  /** تصویر پروفایل گروه (فقط GROUP) */
  avatarUrl?: string | null
  canSend: boolean
  cannotSendReason: string | null
}

/** عضو گروه در دیالوگ اعضا */
export interface GroupMember {
  id: string
  fullName: string
  role: string
  label: string
  avatarUrl: string | null
  /** کاربر فعلی اجازه گفتگوی خصوصی با این عضو را دارد */
  canDm: boolean
  /** AUTO = عضویت خودکار/ثبت‌نامی، ADDED = افزوده‌شده توسط مدیر/معلم */
  status?: 'AUTO' | 'ADDED'
}

export interface GroupMembersData {
  group: {
    id: string
    name: string
    className: string
    policy: string
    archived: boolean
    avatarUrl: string | null
  }
  canManage: boolean
  /** افزودن/حذف دانش‌آموزان (معلم و مدیر) */
  canEditStudents: boolean
  /** افزودن/حذف معلمان (فقط مدیر مدرسه) */
  canEditTeachers: boolean
  canLock: boolean
  studentDmAllowed: boolean
  isStudentViewer: boolean
  members: {
    teachers: GroupMember[]
    students: GroupMember[]
    admins: GroupMember[]
  }
}

/** نامزد افزودن به گروه */
export interface MemberCandidate {
  id: string
  fullName: string
  role: string
  label: string
}

export interface GroupSearchHit {
  id: string
  type: string
  body: string
  refTitle: string | null
  createdAt: string
  pinnedAt: string | null
  senderName: string
}

export interface DmCandidate {
  id: string
  fullName: string
  role: string
  label: string
  note?: string
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`
}
