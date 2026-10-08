"use client";

import * as React from "react";
import { Play, Pause, Loader2, Mic, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { toPersianDigits } from "./persian";

/* ------------------------------------------------------------------ */
/* VoiceMessagePlayer — Telegram-style voice message bubble           */
/* ------------------------------------------------------------------ */

/**
 * A Telegram-style voice message player with:
 *   - A circular play/pause button on the left.
 *   - A real waveform (computed from the audio file via Web Audio API).
 *     Falls back to a deterministic pseudo-random waveform if decoding
 *     fails (CORS, unsupported codec, etc.) so the UI never looks broken.
 *   - A duration timer (mm:ss) on the right; switches to a "remaining"
 *     countdown while playing.
 *   - Progress fill: the bars before the current playback position are
 *     filled with the accent color; bars after are muted.
 *
 * The component is self-contained — it owns an `<audio>` element + the
 * Web Audio decoding logic. The parent just provides the `fileUrl` +
 * whether it's the user's own message (affects the accent color).
 */

interface VoiceMessagePlayerProps {
  /** The URL of the recorded audio file (e.g. /uploads/voice-123.webm). */
  fileUrl: string;
  /** The original file name (used for the download button + as a fallback
   *  seed for the pseudo-random waveform). */
  fileName?: string | null;
  /** The audio MIME type (used to skip the Web Audio decode attempt for
   *  unsupported types — minor perf optimization). */
  mimeType?: string | null;
  /** When true, the bubble uses the primary accent color (own messages).
   *  When false, it uses a neutral/muted style (others' messages). */
  own?: boolean;
}

const NUM_BARS = 36; // the number of waveform bars
const MAX_BAR_HEIGHT = 28; // px
const MIN_BAR_HEIGHT = 4; // px

export function VoiceMessagePlayer({
  fileUrl,
  fileName,
  mimeType,
  own = false,
}: VoiceMessagePlayerProps) {
  // ---------------- State ----------------
  const [bars, setBars] = React.useState<number[]>([]);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [audioReady, setAudioReady] = React.useState(false);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // Used to generate a deterministic fallback waveform.
  const seedRef = React.useRef<string>(fileName || fileUrl || "voice");

  // ---------------- Audio decoding (for the real waveform) ----------------
  React.useEffect(() => {
    let cancelled = false;
    let audioCtx: AudioContext | null = null;

    async function decodeWaveform() {
      try {
        // Fetch the audio file as an ArrayBuffer.
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();

        // Decode the audio using Web Audio API.
        audioCtx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arr);
        if (cancelled) return;

        // Take the first channel's data + downsample to NUM_BARS bars.
        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        const samplesPerBar = Math.max(1, Math.floor(totalSamples / NUM_BARS));
        const newBars: number[] = [];
        for (let i = 0; i < NUM_BARS; i++) {
          let max = 0;
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, totalSamples);
          for (let j = start; j < end; j++) {
            const v = Math.abs(channelData[j]);
            if (v > max) max = v;
          }
          newBars.push(max);
        }
        if (cancelled) return;

        // Normalize so the tallest bar is MAX_BAR_HEIGHT.
        const peak = Math.max(...newBars, 0.001);
        const normalized = newBars.map((v) =>
          Math.max(MIN_BAR_HEIGHT, Math.round((v / peak) * MAX_BAR_HEIGHT)),
        );
        setBars(normalized);
        setDuration(audioBuffer.duration);
        setLoading(false);
        setAudioReady(true);
      } catch {
        if (cancelled) return;
        // Fallback: a deterministic pseudo-random waveform seeded by the
        // file name/URL. Looks like a real waveform even when we can't
        // decode the audio (e.g., CORS-restricted or unsupported codec).
        const fallback = generateFallbackWaveform(seedRef.current);
        setBars(fallback);
        setLoading(false);
        setAudioReady(true);
      } finally {
        if (audioCtx) {
          try {
            // Some browsers need this; others auto-close.
            await audioCtx.close();
          } catch {
            /* ignore */
          }
        }
      }
    }

    void decodeWaveform();
    return () => {
      cancelled = true;
      if (audioCtx) {
        try {
          void audioCtx.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [fileUrl]);

  // ---------------- Audio element setup + event listeners ----------------
  React.useEffect(() => {
    const audio = new Audio();
    audio.src = fileUrl;
    audio.preload = "metadata";
    audioRef.current = audio;

    function onLoadedMetadata() {
      // If Web Audio decoding didn't give us a duration, use the <audio>
      // element's metadata duration.
      setDuration((prev) => prev || audio.duration || 0);
    }
    function onTimeUpdate() {
      setCurrentTime(audio.currentTime);
    }
    function onPlay() {
      setPlaying(true);
    }
    function onPause() {
      setPlaying(false);
    }
    function onEnded() {
      setPlaying(false);
      setCurrentTime(0);
    }
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
    };
  }, [fileUrl]);

  // ---------------- Controls ----------------
  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play().catch(() => {
        // Autoplay can fail; the user will click again.
      });
    }
  }

  function seekToFraction(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !duration || !isFinite(duration)) return;
    audio.currentTime = Math.max(0, Math.min(fraction * duration, duration));
  }

  // ---------------- Derived values ----------------
  const progress = duration > 0 ? currentTime / duration : 0;
  const remaining = Math.max(0, duration - currentTime);
  const displayTime = playing || currentTime > 0 ? remaining : duration;

  // ---------------- Render ----------------
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-2xl px-2.5 py-2 min-w-[220px] max-w-full",
        own
          ? "bg-primary-foreground/10"
          : "bg-muted/40",
      )}
    >
      {/* Play / Pause circular button */}
      <button
        type="button"
        onClick={togglePlayPause}
        disabled={!audioReady}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
          own
            ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
        aria-label={playing ? "توقف پخش" : "پخش پیام صوتی"}
        title={playing ? "توقف" : "پخش"}
      >
        {loading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : playing ? (
          <Pause className="size-5" />
        ) : (
          <Play className="size-5 ltr:ml-0.5" fill="currentColor" />
        )}
      </button>

      {/* Waveform + timer */}
      <div className="flex flex-1 flex-col gap-1">
        {/* Waveform (clickable for seeking) */}
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // In RTL, the click's x is measured from the left, but the
            // waveform's "start" is on the right. So we invert.
            const x = e.clientX - rect.left;
            const fraction = 1 - x / rect.width;
            seekToFraction(fraction);
          }}
          className="relative flex h-7 items-center gap-0.5 disabled:cursor-default"
          aria-label="موج‌صوتی — برای جابجایی کلیک کنید"
          title="برای جابجایی کلیک کنید"
          disabled={!duration || !isFinite(duration)}
        >
          {bars.length === 0
            ? // Loading skeleton bars
              Array.from({ length: NUM_BARS }).map((_, i) => (
                <span
                  key={i}
                  className="inline-block w-1 rounded-full bg-current opacity-30"
                  style={{ height: `${MIN_BAR_HEIGHT + ((i * 7) % 12)}px` }}
                />
              ))
            : bars.map((h, i) => {
                // A bar is "played" if its fraction position is before
                // the current progress.
                const barFraction = (i + 0.5) / NUM_BARS;
                const played = barFraction <= progress;
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-block w-1 rounded-full transition-colors",
                      own
                        ? played
                          ? "bg-primary-foreground"
                          : "bg-primary-foreground/40"
                        : played
                          ? "bg-primary"
                          : "bg-muted-foreground/40",
                    )}
                    style={{ height: `${h}px` }}
                  />
                );
              })}
        </button>

        {/* Timer row */}
        <div className="flex items-center justify-between gap-2 text-[10px] leading-none">
          <span
            className={cn(
              "flex items-center gap-1 tabular-nums persian-nums",
              own ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
            dir="ltr"
          >
            <Mic className="size-3" />
            {formatTime(displayTime)}
          </span>
          {/* Download button */}
          <a
            href={fileUrl}
            download={fileName || true}
            className={cn(
              "inline-flex items-center gap-1 rounded transition-colors hover:opacity-80",
              own ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
            aria-label="دانلود پیام صوتی"
            title="دانلود"
          >
            <Download className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Format seconds → mm:ss in Persian digits. */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${toPersianDigits(String(m).padStart(2, "0"))}:${toPersianDigits(
    String(s).padStart(2, "0"),
  )}`;
}

/**
 * Generate a deterministic pseudo-random waveform (used as a fallback when
 * the real audio can't be decoded). The seed makes it consistent per-file
 * so the same voice message always shows the same waveform.
 */
function generateFallbackWaveform(seed: string): number[] {
  // Simple string hash → a 32-bit int.
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  // Mulberry32 PRNG for deterministic randomness.
  let state = h >>> 0;
  function rand() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const bars: number[] = [];
  for (let i = 0; i < NUM_BARS; i++) {
    // Bars in the middle tend to be taller (envelope shape) — looks more
    // like a real voice waveform than uniform noise.
    const envelope = 0.5 + 0.5 * Math.sin((i / NUM_BARS) * Math.PI);
    const v = MIN_BAR_HEIGHT + rand() * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * envelope;
    bars.push(Math.round(v));
  }
  return bars;
}
