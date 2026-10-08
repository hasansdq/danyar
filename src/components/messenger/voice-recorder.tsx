"use client";

import * as React from "react";
import { Mic, Square, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { toPersianDigits } from "./persian";

/* ------------------------------------------------------------------ */
/* VoiceRecorder — in-composer voice message recorder                 */
/* ------------------------------------------------------------------ */

/**
 * A reusable voice-recording button for the message composer.
 *
 * Uses the browser's MediaRecorder API to capture audio from the
 * microphone. The recording flow (WhatsApp-style):
 *
 *   1. The user clicks the Mic button (visible only when the textarea
 *      is empty — replaces the Send button so the composer doesn't get
 *      crowded).
 *   2. The browser prompts for microphone permission (if not already
 *      granted). On grant, recording starts.
 *   3. The composer row transforms into a "recording" UI:
 *        [● recording] [timer 00:12] [waveform] [cancel X] [send ✓]
 *      The red dot pulses; the timer counts up; the send button stops
 *      the recording + hands the File to the parent.
 *   4. The cancel (X) button stops + discards the recording.
 *   5. The send (✓) button stops + hands the recorded audio File to
 *      `onSend(file)` — the parent uploads + posts it as a normal file
 *      attachment message (so the chat-service's existing file-relay
 *      path handles it, no new socket event needed).
 *
 * Fallbacks / errors:
 *   - If the browser doesn't support MediaRecorder → toast + hide the
 *     Mic button (the user can still send text/files).
 *   - If the user denies microphone permission → toast + cancel the
 *     recording state.
 *   - If the recording produces no audio data (rare) → toast + cancel.
 *
 * The recorded File is named `voice-<timestamp>.webm` (or `.ogg` on
 * Firefox — both are supported by the existing file-upload route +
 * the chat's audio-player UI).
 */

interface VoiceRecorderProps {
  /** Called with the recorded audio File when the user taps "send". */
  onSend: (file: File) => void | Promise<void>;
  /** Disable the trigger (e.g. when the chat is closed or file uploads
   *  are disabled in the class). */
  disabled?: boolean;
  /** Optional className for the trigger button. */
  className?: string;
  /** Phase 27 — called whenever the recorder transitions between idle ↔
   *  recording. The parent uses this to hide the rest of the composer
   *  (emoji button, paperclip, textarea) on mobile/tablet so the
   *  recording UI takes the full width of the bottom bar — like Telegram
   *  + WhatsApp do. */
  onRecordingChange?: (recording: boolean) => void;
}

type RecorderState = "idle" | "recording" | "stopping";

const MAX_RECORDING_SECONDS = 180; // 3 minutes — WhatsApp's limit

export function VoiceRecorder({
  onSend,
  disabled,
  className,
  onRecordingChange,
}: VoiceRecorderProps) {
  const { toast } = useToast();
  const [state, setState] = React.useState<RecorderState>("idle");
  const [seconds, setSeconds] = React.useState(0);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<BlobPart[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = React.useState<string>("audio/webm")[0];
  // Keep a ref to the latest onRecordingChange so the setState wrapper
  // below doesn't need it in its dependency array (avoids re-runs).
  const onRecordingChangeRef = React.useRef(onRecordingChange);
  React.useEffect(() => {
    onRecordingChangeRef.current = onRecordingChange;
  }, [onRecordingChange]);

  // Wrap setState so we notify the parent whenever the recording state
  // transitions. "recording" → true; "idle" → false. "stopping" is a
  // transient state — treat it as recording=true so the parent keeps
  // the composer hidden until the recording is fully processed.
  const updateState = React.useCallback((next: RecorderState) => {
    setState((prev) => {
      const wasRecording = prev === "recording" || prev === "stopping";
      const isRecording = next === "recording" || next === "stopping";
      if (wasRecording !== isRecording) {
        // Defer the callback so it doesn't fire during React's render
        // phase (would cause a "Cannot update a component while rendering
        // a different component" warning).
        Promise.resolve().then(() => onRecordingChangeRef.current?.(isRecording));
      }
      return next;
    });
  }, []);

  // Cleanup on unmount.
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function startTimer() {
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_RECORDING_SECONDS) {
          // Auto-stop at the limit.
          void stopRecording("auto");
          return s;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    if (disabled || state !== "idle") return;

    // Feature-detect MediaRecorder.
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "ضبط صدا پشتیبانی نمی‌شود",
        description: "مرورگر شما امکان ضبط صدا را ندارد.",
        variant: "destructive",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      // Pick a supported mime type (webm on Chrome, ogg on Firefox).
      const mimeTypes = ["audio/webm", "audio/ogg", "audio/mp4"];
      const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleRecorderStop;

      recorder.start(100); // collect data in 100ms chunks
      updateState("recording");
      startTimer();
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        toast({
          title: "دسترسی به میکروفون رد شد",
          description: "لطفاً دسترسی به میکروفون را در تنظیمات مرورگر فعال کنید.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "خطا در شروع ضبط",
          description: e.message || "خطای غیرمنتظره",
          variant: "destructive",
        });
      }
      cleanupStream();
      updateState("idle");
    }
  }

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }

  async function stopRecording(_reason: "manual" | "auto" | "send" = "manual") {
    if (state !== "recording") return;
    updateState("stopping");
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // The onstop handler will fire + build the File.
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    } else {
      cleanupStream();
      updateState("idle");
    }
  }

  function handleRecorderStop() {
    const chunks = chunksRef.current;
    const mimeType = recorderRef.current?.mimeType || mimeTypeRef;
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    cleanupStream();

    if (blob.size === 0) {
      toast({
        title: "ضبط ناموفق بود",
        description: "هیچ صدایی ضبط نشد.",
        variant: "destructive",
      });
      updateState("idle");
      return;
    }

    // Build a File with a friendly name.
    const ext = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mp4")
        ? "mp4"
        : "webm";
    const filename = `voice-${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: mimeType || "audio/webm" });
    updateState("idle");
    void onSend(file);
  }

  function cancelRecording() {
    // Stop the recorder but discard the data.
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Detach the onstop handler so it doesn't fire onSend.
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupStream();
    updateState("idle");
  }

  // ---------- Idle state: just the Mic trigger ----------
  if (state === "idle") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => void startRecording()}
        className={cn("size-9 shrink-0", className)}
        aria-label="ضبط پیام صوتی"
        title="ضبط پیام صوتی"
      >
        <Mic className="size-5" />
      </Button>
    );
  }

  // ---------- Recording / stopping state: the recording UI ----------
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex flex-1 items-center gap-2">
      {/* Red pulsing dot */}
      <span className="relative flex size-3 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-red-500" />
      </span>
      <span className="text-xs font-medium text-red-600 dark:text-red-400">
        {state === "stopping" ? "در حال پایان…" : "در حال ضبط"}
      </span>

      {/* Timer */}
      <span className="font-mono text-sm tabular-nums text-foreground persian-nums" dir="ltr">
        {toPersianDigits(mm)}:{toPersianDigits(ss)}
      </span>

      {/* Fake waveform — animated bars */}
      <div className="flex flex-1 items-center gap-0.5 overflow-hidden px-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="inline-block w-0.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/40"
            style={{
              height: `${4 + ((i * 7) % 16)}px`,
              animationDelay: `${i * 60}ms`,
              animationDuration: "0.8s",
            }}
          />
        ))}
      </div>

      {/* Cancel button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={cancelRecording}
        disabled={state === "stopping"}
        className="size-9 shrink-0 text-destructive hover:bg-destructive/10"
        aria-label="لغو ضبط"
        title="لغو"
      >
        <X className="size-5" />
      </Button>

      {/* Send (stop + send) button */}
      <Button
        type="button"
        size="icon"
        onClick={() => void stopRecording("send")}
        disabled={state === "stopping"}
        className="size-9 shrink-0"
        aria-label="ارسال پیام صوتی"
        title="ارسال"
      >
        {state === "stopping" ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Send className="size-5" />
        )}
      </Button>
    </div>
  );
}
