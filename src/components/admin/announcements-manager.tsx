"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone,
  Paperclip,
  X,
  Send,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";
import { toPersianDigits } from "@/components/messenger/persian";
import { formatFileSize } from "@/components/messenger/file-helpers";
import type { ClassItem } from "@/components/messenger/types";

interface AdminClassItem extends ClassItem {
  teacherCount?: number;
}

export function AnnouncementsManager({ user }: { user: { id: string; role: string; schoolId?: string | null } }) {
  const { toast } = useToast();
  const [content, setContent] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [selectedClassIds, setSelectedClassIds] = React.useState<Set<string>>(new Set());
  const [sending, setSending] = React.useState(false);

  const { data: classes, isLoading, refetch, isFetching } = useQuery<AdminClassItem[]>({
    queryKey: ["admin-classes-announcements", user.id],
    queryFn: () => apiFetch<AdminClassItem[]>("/api/classes"),
  });

  function toggleClass(id: string) {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!classes || classes.length === 0) return;
    if (selectedClassIds.size === classes.length) {
      setSelectedClassIds(new Set());
    } else {
      setSelectedClassIds(new Set(classes.map((c) => c.id)));
    }
  }

  async function sendAnnouncement() {
    if (!content.trim() && !file) return;
    if (selectedClassIds.size === 0) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("content", content.trim());
      for (const id of selectedClassIds) fd.append("classIds", id);
      if (file) fd.set("file", file);
      const res = await fetch("/api/teacher/announce", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "خطا در ارسال اطلاعیه");
      toast({
        title: "اطلاعیه ارسال شد",
        description: `به ${toPersianDigits(json.data?.count ?? 0)} کلاس`,
      });
      setContent("");
      setFile(null);
      setSelectedClassIds(new Set());
    } catch (err) {
      toast({
        title: "خطا",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            ارسال اطلاعیه
          </h2>
          <p className="text-muted-foreground text-sm">
            پیام اطلاعیه را برای یک یا چند کلاس ارسال کنید. اطلاعیه‌ها در گفتگوی کلاس با کادر قرمز متحرک نمایش داده می‌شوند.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
          به‌روزرسانی
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-5 text-primary" />
            اطلاعیه جدید
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          {/* Message text */}
          <div className="flex flex-col gap-2">
            <Label>متن اطلاعیه</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="مثال: سلام عزیزانم، به علت بارش برف فردا مدرسه تعطیله 😊"
              rows={3}
              maxLength={2000}
              className="resize-none"
            />
            <p className="text-muted-foreground text-xs">
              {toPersianDigits(content.length)} از {toPersianDigits(2000)} کاراکتر
            </p>
          </div>

          {/* File upload */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">فایل پیوست (اختیاری):</Label>
            <label className="cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf,video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
              <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                <Paperclip className="size-3.5" />
                {file ? file.name.substring(0, 20) + (file.name.length > 20 ? "…" : "") : "انتخاب فایل"}
              </span>
            </label>
            {file && (
              <>
                <button
                  onClick={() => setFile(null)}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                >
                  <X className="size-3" />
                  حذف
                </button>
                <span className="text-muted-foreground text-xs">{formatFileSize(file.size)}</span>
              </>
            )}
          </div>

          {/* Class selection */}
          <div className="border-t pt-3">
            <div className="mb-2 flex items-center gap-2">
              <Checkbox
                checked={!!classes && classes.length > 0 && selectedClassIds.size === classes.length}
                onCheckedChange={toggleSelectAll}
                aria-label="انتخاب همه کلاس‌ها"
              />
              <Label className="text-sm cursor-pointer">
                انتخاب همه ({toPersianDigits(classes?.length ?? 0)} کلاس)
              </Label>
            </div>
            {isLoading ? (
              <p className="text-muted-foreground text-sm">در حال بارگذاری کلاس‌ها...</p>
            ) : !classes || classes.length === 0 ? (
              <p className="text-muted-foreground text-sm">هیچ کلاسی ثبت نشده است.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                      selectedClassIds.has(c.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Checkbox
                      checked={selectedClassIds.has(c.id)}
                      onCheckedChange={() => toggleClass(c.id)}
                    />
                    {c.name}
                    {c.section ? ` · شعبه ${c.section}` : ""}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Send button */}
          <div className="flex items-center gap-3 border-t pt-3">
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              {toPersianDigits(selectedClassIds.size)} کلاس انتخاب شده
            </Badge>
            <Button
              size="sm"
              className="gap-2"
              onClick={sendAnnouncement}
              disabled={sending || (!content.trim() && !file) || selectedClassIds.size === 0}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sending ? "در حال ارسال..." : "ارسال اطلاعیه"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
