"use client";

import * as React from "react";
import {
  Bell,
  Send,
  Loader2,
  Upload,
  Music,
  Play,
  Volume2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";
import { toPersianDigits } from "@/components/messenger/persian";

// Default notification sounds (bundled with the app in /public/sounds/).
const DEFAULT_SOUNDS = [
  { value: "", label: "پیش‌فرض مرورگر" },
  { value: "/sounds/notification.mp3", label: "صدای پیش‌فرض دانیار" },
  { value: "/sounds/chime.mp3", label: "زنگ" },
  { value: "/sounds/ding.mp3", label: "دینگ" },
];

export function NotificationsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [target, setTarget] = React.useState("all");
  const [selectedRole, setSelectedRole] = React.useState("STUDENT");
  const [sending, setSending] = React.useState(false);

  // Phase 35g — notification sound selection.
  const [selectedSound, setSelectedSound] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadedSounds, setUploadedSounds] = React.useState<Array<{ value: string; label: string }>>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Fetch current sound setting + uploaded sounds list.
  const { data: soundData } = useQuery<{ current: string; uploaded: Array<{ url: string; name: string }> }>({
    queryKey: ["notification-sound"],
    queryFn: () => apiFetch("/api/superadmin/notification-sound"),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (soundData) {
      setSelectedSound(soundData.current || "");
      setUploadedSounds(
        (soundData.uploaded ?? []).map((s) => ({
          value: s.url,
          label: s.name,
        })),
      );
    }
  }, [soundData]);

  async function sendBroadcast() {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const res = await apiFetch<{
        totalUsers: number;
        totalSent: number;
        totalFailed: number;
      }>("/api/superadmin/push-broadcast", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          target,
          role: target === "role" ? selectedRole : undefined,
        }),
      });
      toast({
        title: "نوتیفیکیشن ارسال شد",
        description: `به ${toPersianDigits(res.totalUsers)} کاربر ارسال شد`,
      });
      setTitle("");
      setBody("");
    } catch (err) {
      toast({ title: "خطا", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function handleSoundUpload(file: File) {
    if (!file) return;
    const validTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/aac"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|aac)$/i)) {
      toast({ title: "فرمت نامعتبر", description: "فقط فایل‌های mp3, wav, ogg, aac", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "فایل بیش از حد بزرگ", description: "حداکثر ۲ مگابایت", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await apiFetch<{ url: string; name: string }>("/api/superadmin/notification-sound/upload", {
        method: "POST",
        body: fd,
      });
      setUploadedSounds((prev) => [...prev, { value: res.url, label: res.name }]);
      setSelectedSound(res.url);
      toast({ title: "فایل صوتی آپلود شد", description: res.name });
    } catch (err) {
      toast({ title: "خطا در آپلود", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveSound() {
    try {
      await apiFetch("/api/superadmin/notification-sound", {
        method: "PATCH",
        body: JSON.stringify({ sound: selectedSound }),
      });
      qc.invalidateQueries({ queryKey: ["notification-sound"] });
      toast({ title: "صدای نوتیفیکیشن ذخیره شد" });
    } catch (err) {
      toast({ title: "خطا", description: (err as Error).message, variant: "destructive" });
    }
  }

  function previewSound() {
    if (!selectedSound) return;
    const audio = new Audio(selectedSound);
    void audio.play().catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">مدیریت پوش نوتیفیکیشن</h2>
        <p className="text-muted-foreground text-sm">ارسال و مدیریت نوتیفیکیشن‌های پوش به کاربران سامانه</p>
      </div>

      {/* Phase 35g — notification sound upload + selection */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <Music className="size-5 text-primary" />
            صدای نوتیفیکیشن
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <Label>انتخاب صدا</Label>
            <div className="flex items-center gap-2">
              <Select value={selectedSound} onValueChange={setSelectedSound}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="یک صدا انتخاب کنید" /></SelectTrigger>
                <SelectContent>
                  {DEFAULT_SOUNDS.map((s) => (
                    <SelectItem key={s.value || "default"} value={s.value || "default"}>
                      {s.label}
                    </SelectItem>
                  ))}
                  {uploadedSounds.length > 0 && (
                    <>
                      <SelectItem value="__separator__" disabled>— آپلود شده —</SelectItem>
                      {uploadedSounds.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" onClick={previewSound} disabled={!selectedSound || selectedSound === "default"} title="پخش پیش‌نمایش">
                <Play className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1.5">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                <span className="hidden sm:inline">آپلود صدا</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.aac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleSoundUpload(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              فایل صوتی (mp3, wav, ogg, aac — حداکثر ۲MB) آپلود کنید یا یکی از صداهای پیش‌فرض را انتخاب کنید.
            </p>
          </div>
          <Button type="button" onClick={handleSaveSound} variant="default" className="gap-1.5 self-start">
            <Volume2 className="size-4" />
            ذخیره صدای انتخاب‌شده
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="size-5 text-primary" />
            ارسال نوتیفیکیشن
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <Label>عنوان</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: اطلاعیه مهم" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>متن</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن نوتیفیکیشن..." rows={3} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>گیرندگان</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه کاربران</SelectItem>
                <SelectItem value="role">بر اساس نقش</SelectItem>
                <SelectItem value="school">بر اساس مدرسه</SelectItem>
                <SelectItem value="user">کاربر خاص</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {target === "role" && (
            <div className="flex flex-col gap-2">
              <Label>نقش</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="STUDENT">دانش‌آموزان</SelectItem>
                  <SelectItem value="TEACHER">معلمان</SelectItem>
                  <SelectItem value="ADMIN">مدیران مدارس</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={sendBroadcast} disabled={sending || !title.trim() || !body.trim()} className="gap-2">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? "در حال ارسال..." : "ارسال نوتیفیکیشن"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
