"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark, FileText, Image as ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "./file-helpers";
import { formatPersianDate } from "./persian";
import { fetchSavedMessages, type SavedMessage } from "@/lib/messenger-api";

export function SavedMessagesView() {
  const { data, isLoading, isError, refetch } = useQuery<SavedMessage[]>({
    queryKey: ["saved-messages"],
    queryFn: () => fetchSavedMessages(),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive text-sm">
          بارگذاری ناموفق بود.
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Bookmark className="size-8 text-muted-foreground" />
          <p className="font-medium">هیچ پیامی ذخیره نشده است</p>
          <p className="text-sm text-muted-foreground">
            با کلیک روی منوی عملیات هر پیام، می‌توانید آن را ذخیره کنید.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-muted-foreground">
        {data.length} پیام ذخیره‌شده
      </p>
      {data.map((msg) => (
        <Card key={msg.id}>
          <CardContent className="py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {msg.sender.fullName}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {msg.class.name}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatPersianDate(msg.savedAt)}
              </span>
            </div>
            {msg.content ? (
              <p className="text-sm leading-relaxed">{msg.content}</p>
            ) : null}
            {msg.fileUrl && msg.fileName ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5">
                {msg.fileType === "image" ? (
                  <ImageIcon className="size-4 text-primary" />
                ) : (
                  <FileText className="size-4 text-primary" />
                )}
                <span className="text-xs truncate">{msg.fileName}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
