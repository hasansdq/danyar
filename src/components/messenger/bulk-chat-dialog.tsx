"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone,
  Lock,
  Send,
  Loader2,
  Wifi,
  WifiOff,
  School,
  MessageSquareWarning,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { fetchClasses } from "@/lib/messenger-api";
import { toPersianDigits } from "./persian";
import {
  useBulkChatSocket,
  type BulkChatUser,
} from "./use-bulk-chat-socket";
import type { ClassItem, MessengerUser } from "./types";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

const MAX_BROADCAST_LEN = 2000;

interface BulkChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The signed-in teacher (or admin) — drives the socket auth payload. */
  user: MessengerUser;
}

/**
 * Teacher / admin bulk chat management Sheet.
 *
 * Same two operations as the admin page (`/admin/bulk-chat`) but rendered as a
 * side-panel Sheet accessible from the messenger header. The socket service
 * uses the connecting user's auth payload + their class memberships to
 * determine which classes the operations apply on (typically: the teacher's
 * classes).
 */
export function BulkChatDialog({
  open,
  onOpenChange,
  user,
}: BulkChatDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Lazily fetch the user's classes (only when the sheet opens) so we don't
  // make redundant requests on every messenger render.
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  // The socket hook connects on mount. Only mount the body while the Sheet is
  // open so we don't hold an idle socket connection while the user browses.
  const socketUser: BulkChatUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b bg-background px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageSquareWarning className="size-4" />
            </span>
            مدیریت گفتگوها
          </SheetTitle>
          <SheetDescription className="sr-only">
            بستن همه گفتگوهای کلاس‌ها یا ارسال پیام یکسان
          </SheetDescription>
        </SheetHeader>

        {open ? (
          <BulkChatDialogBody
            user={socketUser}
            classes={classes ?? []}
            classesLoading={classesLoading}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ["classes"] });
            }}
            toast={toast}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface BulkChatDialogBodyProps {
  user: BulkChatUser;
  classes: ClassItem[];
  classesLoading: boolean;
  onDone: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}

function BulkChatDialogBody({
  user,
  classes,
  classesLoading,
  onDone,
  toast,
}: BulkChatDialogBodyProps) {
  const { connected, error: socketError, emitBulkClose, emitBulkBroadcast } =
    useBulkChatSocket(user);

  // ---- Close-all dialog state ----
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  async function handleCloseAll() {
    setClosing(true);
    try {
      const { closedCount } = await emitBulkClose();
      toast({
        title: "همه گفتگوها بسته شدند",
        description:
          typeof closedCount === "number"
            ? `${toPersianDigits(closedCount)} کلاس بسته شد.`
            : "دانش‌آموزان دیگر قادر به ارسال پیام نخواهند بود.",
      });
      setCloseOpen(false);
      onDone();
    } catch (e) {
      toast({
        title: "خطا در بستن گفتگوها",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setClosing(false);
    }
  }

  // ---- Broadcast state ----
  const [content, setContent] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const trimmed = content.trim();
  const canSend =
    connected &&
    !sending &&
    trimmed.length > 0 &&
    trimmed.length <= MAX_BROADCAST_LEN;

  async function handleBroadcast() {
    if (!canSend) return;
    setSending(true);
    try {
      const { sentCount } = await emitBulkBroadcast(trimmed);
      toast({
        title: "پیام به همه گفتگوها ارسال شد",
        description:
          typeof sentCount === "number"
            ? `پیام در ${toPersianDigits(sentCount)} کلاس ارسال شد.`
            : undefined,
      });
      setContent("");
      onDone();
    } catch (e) {
      toast({
        title: "خطا در ارسال پیام",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden">
      {/* Connection + scope info */}
      <div className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-3 text-xs">
        <div className="flex items-center justify-between">
          <span
            className={`flex items-center gap-1 ${
              connected ? "text-emerald-600" : "text-muted-foreground"
            }`}
          >
            {connected ? (
              <>
                <Wifi className="size-3" />
                متصل
              </>
            ) : (
              <>
                <WifiOff className="size-3" />
                قطع ارتباط
              </>
            )}
          </span>
          <span className="text-muted-foreground persian-nums">
            {classesLoading
              ? "در حال بارگذاری کلاس‌ها..."
              : `${toPersianDigits(classes.length)} کلاس`}
          </span>
        </div>
        {classes.length > 0 ? (
          <p className="text-muted-foreground leading-relaxed">
            این عمل روی این کلاس‌ها اعمال می‌شود:{" "}
            <span className="text-foreground font-medium">
              {classes.map((c) => c.name).join("، ")}
            </span>
          </p>
        ) : null}
        {socketError ? (
          <p className="text-destructive">{socketError}</p>
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* ---- Close all chats card ---- */}
          <Card>
            <CardHeader className="border-b p-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
                  <Lock className="size-4" />
                </span>
                بستن همه گفتگوها
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                با این عمل، گفتگوی همه کلاس‌های شما برای دانش‌آموزان بسته
                می‌شود. شما همچنان می‌توانید پیام ارسال کنید.
              </p>
              <Button
                variant="destructive"
                onClick={() => setCloseOpen(true)}
                disabled={!connected || closing || classes.length === 0}
                className="w-full gap-2"
              >
                <Lock className="size-4" />
                {closing ? "در حال بستن..." : "بستن همه گفتگوها"}
              </Button>
            </CardContent>
          </Card>

          {/* ---- Broadcast card ---- */}
          <Card>
            <CardHeader className="border-b p-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Megaphone className="size-4" />
                </span>
                ارسال پیام یکسان
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="پیام خود را بنویسید..."
                rows={5}
                maxLength={MAX_BROADCAST_LEN}
                disabled={!connected}
                className="resize-none"
              />
              <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span
                  className={`text-xs persian-nums ${
                    trimmed.length > MAX_BROADCAST_LEN
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {toPersianDigits(content.length)} /{" "}
                  {toPersianDigits(MAX_BROADCAST_LEN)}
                </span>
                <Button
                  onClick={handleBroadcast}
                  disabled={!canSend}
                  className="gap-2 sm:w-auto"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {sending ? "در حال ارسال..." : "ارسال به همه"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ---- Affected classes preview ---- */}
          <Card>
            <CardHeader className="border-b p-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-foreground">
                  <School className="size-4" />
                </span>
                کلاس‌های شما
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {classesLoading ? (
                <div className="flex flex-col gap-2 p-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : classes.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center text-sm">
                  شما هنوز کلاسی ندارید.
                </div>
              ) : (
                <ul className="divide-y">
                  {classes.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {c.name}
                        </span>
                        {c.gradeLevel ? (
                          <span className="text-muted-foreground text-xs">
                            پایه: {c.gradeLevel}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-muted-foreground text-xs persian-nums">
                        {toPersianDigits(c.memberCount)} عضو
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={(o) => !o && !closing && setCloseOpen(false)}
        title="بستن همه گفتگوها"
        description="آیا مطمئن هستید که می‌خواهید همه گفتگوها را ببندید؟ دانش‌آموزان دیگر قادر به ارسال پیام نخواهند بود."
        confirmText="بستن همه"
        cancelText="انصراف"
        loading={closing}
        onConfirm={handleCloseAll}
      />
    </div>
  );
}
