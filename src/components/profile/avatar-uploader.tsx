"use client";

import * as React from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { uploadAvatar, deleteAvatar } from "@/lib/messenger-api";
import { ChatAvatar } from "@/components/messenger/chat-avatar";

/**
 * Avatar uploader card — used inside the ProfileDialog.
 *
 * Shows the current avatar (image when present, else the letter-bubble
 * fallback) and provides:
 *   - "تغییر تصویر" — opens a hidden file picker; on select, POSTs the file
 *     to `/api/user/avatar` (multipart) and notifies the parent via
 *     `onUpdated(fileUrl)` + a success toast.
 *   - "حذف تصویر" — only shown when an avatar is set; DELETEs the avatar
 *     and notifies the parent via `onUpdated(null)` + a success toast.
 *
 * While the upload is in-flight, the trigger shows a spinner and the
 * buttons are disabled to prevent double-submission.
 */
export function AvatarUploader({
  currentAvatar,
  fullName,
  onUpdated,
}: {
  currentAvatar?: string | null;
  fullName: string;
  onUpdated: (avatar: string | null) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  function handlePickFile() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  async function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    // Always clear the input value so the same file can be picked again
    // after an error.
    if (e.target) e.target.value = "";
    if (!file) return;

    // Client-side guard: only images, max 25 MB (mirrors the backend's
    // `MAX_FILE_BYTES` limit in src/lib/upload.ts).
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 25) {
      toast({
        title: "خطا",
        description: "حجم تصویر نباید بیشتر از ۲۵ مگابایت باشد.",
        variant: "destructive",
      });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({
        title: "خطا",
        description: "فقط فایل تصویر مجاز است.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const result = await uploadAvatar(file);
      onUpdated(result.avatar);
      toast({
        title: "به‌روزرسانی شد",
        description: "تصویر پروفایل به‌روزرسانی شد.",
      });
    } catch (err) {
      toast({
        title: "خطا در بارگذاری",
        description:
          (err as Error)?.message ||
          "بارگذاری تصویر ناموفق بود. لطفاً دوباره تلاش کنید.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    try {
      await deleteAvatar();
      onUpdated(null);
      toast({
        title: "حذف شد",
        description: "تصویر پروفایل حذف شد.",
      });
    } catch (err) {
      toast({
        title: "خطا در حذف",
        description:
          (err as Error)?.message ||
          "حذف تصویر ناموفق بود. لطفاً دوباره تلاش کنید.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || removing;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Large avatar preview — image when set, else letter bubble. */}
      <ChatAvatar
        fullName={fullName}
        avatar={currentAvatar}
        size="md"
        className="size-20 text-2xl"
      />

      {/* Hidden file input — triggered by the "تغییر تصویر" button. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
        disabled={busy}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handlePickFile}
          disabled={busy}
          className="gap-2"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          تغییر تصویر
        </Button>
        {currentAvatar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={busy}
            className="gap-2 text-destructive hover:text-destructive"
          >
            {removing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            حذف تصویر
          </Button>
        ) : null}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        فقط فایل تصویری (png / jpg / gif / webp) حداکثر تا ۲۵ مگابایت.
      </p>
    </div>
  );
}
