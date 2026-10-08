"use client";

import * as React from "react";
import { Smile, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* EmojiPicker — WhatsApp-style emoji picker for the message composer */
/* ------------------------------------------------------------------ */

/**
 * A reusable emoji picker that opens in a Popover above the trigger button.
 *
 * Features (Phase 25):
 *   - WhatsApp-style grid of emojis grouped by category (tabs at the bottom).
 *   - A search field at the top — filters emojis by name/keyword.
 *   - "Recently used" tracking via localStorage (persists across sessions).
 *   - On select: calls `onSelect(emoji: string)` so the parent can insert
 *     the emoji at the cursor position in the textarea.
 *
 * The picker is intentionally lightweight (no external emoji library) —
 * the emoji list is a static curated set of ~210 emojis across 8 categories.
 * The grid uses a 8-column layout with comfortable touch targets (32px).
 */

// ----------------------------------------------------------------
// Curated emoji data (categories + emojis with search keywords)
// ----------------------------------------------------------------

type EmojiEntry = { char: string; name: string; keywords: string[] };

const CATEGORIES: Array<{
  id: string;
  label: string;
  icon: string; // a single emoji used as the tab icon
  emojis: EmojiEntry[];
}> = [
  {
    id: "recent",
    label: "اخیراً استفاده‌شده",
    icon: "🕘",
    emojis: [], // populated at runtime from localStorage
  },
  {
    id: "smileys",
    label: "صورتک‌ها",
    icon: "😀",
    emojis: [
      { char: "😀", name: "چهره خندان", keywords: ["happy", "smile", "خنداندن", "شاد"] },
      { char: "😃", name: "چهره خندان با چشمان بزرگ", keywords: ["happy", "joy", "شاد"] },
      { char: "😄", name: "چهره خندان با اشک شادی", keywords: ["happy", "joy", "شاد"] },
      { char: "😁", name: "چهره با لبخند و چشمان خندان", keywords: ["grin", "لبخند"] },
      { char: "😆", name: "چهره خندان با چشمان بسته", keywords: ["laugh", "خنده"] },
      { char: "😅", name: "چهره با عرق شرم", keywords: ["sweat", "خجالت"] },
      { char: "🤣", name: "غلتیدن روی زمین از خنده", keywords: ["rofl", "خنده"] },
      { char: "😂", name: "چهره با اشک خنده", keywords: ["tears", "خنده"] },
      { char: "🙂", name: "چهره با لبخند کمی", keywords: ["smile", "لبخند"] },
      { char: "😉", name: "چهره با پلک زدن", keywords: ["wink", "چشمک"] },
      { char: "😊", name: "چهره لبخند با چشمان خندان", keywords: ["blush", "خجالتی"] },
      { char: "😍", name: "چهره با قلب‌های چشمی", keywords: ["love", "عشق"] },
      { char: "🥰", name: "چهره با قلب‌ها", keywords: ["love", "عشق"] },
      { char: "😘", name: "چهره بوسه", keywords: ["kiss", "بوسه"] },
      { char: "😎", name: "چهره با عینک آفتابی", keywords: ["cool", "cool"] },
      { char: "🤩", name: "چهره ستاره‌ای چشمی", keywords: ["star", "ستاره"] },
      { char: "🤔", name: "چهره متفکر", keywords: ["think", "فکر"] },
      { char: "🤨", name: "چهره با ابروی بالا", keywords: ["raise", "شک"] },
      { char: "😐", name: "چهره خنثی", keywords: ["neutral", "خنثی"] },
      { char: "😶", name: "چهره بدون دهان", keywords: ["mute", "سکوت"] },
      { char: "🙄", name: "چهره با چشم‌چرخانی", keywords: ["roll", "بی‌تفاوت"] },
      { char: "😏", name: "چهره با لبخند مغرورانه", keywords: ["smirk", "مغرور"] },
      { char: "😴", name: "چهره خواب", keywords: ["sleep", "خواب"] },
      { char: "😭", name: "چهره گریان بلند", keywords: ["cry", "گریه"] },
      { char: "😡", name: "چهره عصبانی", keywords: ["angry", "عصبانی"] },
      { char: "🤬", name: "چهره با دهان فحش", keywords: ["swear", "فحش"] },
      { char: "🥳", name: "چهره جشن", keywords: ["party", "جشن"] },
      { char: "🤯", name: "چهره منفجر شونده", keywords: ["mind", "منفجر"] },
    ],
  },
  {
    id: "gestures",
    label: "اشاره‌ها",
    icon: "👍",
    emojis: [
      { char: "👍", name: "انگشت شست بالا", keywords: ["like", "good", "موافقت"] },
      { char: "👎", name: "انگشت شست پایین", keywords: ["dislike", "bad", "مخالفت"] },
      { char: "👌", name: "نماد OK", keywords: ["ok", "باشه"] },
      { char: "✌️", name: "پیروزی", keywords: ["peace", "victory", "صلح"] },
      { char: "🤞", name: "انگشتان ضرب‌در", keywords: ["luck", "شانس"] },
      { char: "🤟", name: "عشق-سلام", keywords: ["love", "rock"] },
      { char: "🤙", name: "همان‌جاست", keywords: ["call", "تماس"] },
      { char: "👋", name: "دست تکان دادن", keywords: ["wave", "hi", "سلام"] },
      { char: "🙏", name: "دعای تشکر", keywords: ["pray", "thanks", "دعا"] },
      { char: "👏", name: "دست زدن", keywords: ["clap", "تشویق"] },
      { char: "🙌", name: "دست‌های بالا", keywords: ["raise", "celebrate", "هورا"] },
      { char: "💪", name: "بازو", keywords: ["flex", "strength", "قوی"] },
      { char: "✋", name: "دست بلند شده", keywords: ["stop", "stop", "ایست"] },
      { char: "🤝", name: "دست دادن", keywords: ["handshake", "deal", "معامله"] },
    ],
  },
  {
    id: "hearts",
    label: "قلب‌ها",
    icon: "❤️",
    emojis: [
      { char: "❤️", name: "قلب قرمز", keywords: ["love", "عشق"] },
      { char: "🧡", name: "قلب نارنجی", keywords: ["love", "عشق"] },
      { char: "💛", name: "قلب زرد", keywords: ["love", "عشق"] },
      { char: "💚", name: "قلب سبز", keywords: ["love", "عشق"] },
      { char: "💙", name: "قلب آبی", keywords: ["love", "عشق"] },
      { char: "💜", name: "قلب بنفش", keywords: ["love", "عشق"] },
      { char: "🖤", name: "قلب مشکی", keywords: ["love", "عشق"] },
      { char: "🤍", name: "قلب سفید", keywords: ["love", "عشق"] },
      { char: "💔", name: "قلب شکسته", keywords: ["broken", "شکسته"] },
      { char: "💕", name: "دو قلب", keywords: ["love", "عشق"] },
      { char: "💖", name: "قلب درخشان", keywords: ["love", "عشق"] },
      { char: "💝", name: "قلب با روبان", keywords: ["gift", "هدیه"] },
    ],
  },
  {
    id: "objects",
    label: "اشیاء",
    icon: "💡",
    emojis: [
      { char: "⭐", name: "ستاره", keywords: ["star", "ستاره"] },
      { char: "🌟", name: "ستاره درخشان", keywords: ["star", "ستاره"] },
      { char: "✨", name: "جرقه", keywords: ["sparkle", "جرقه"] },
      { char: "🔥", name: "آتش", keywords: ["fire", "آتش"] },
      { char: "💡", name: "لامپ", keywords: ["idea", "light", "ایده"] },
      { char: "🎉", name: "جشن", keywords: ["party", "جشن"] },
      { char: "🎁", name: "هدیه", keywords: ["gift", "present", "هدیه"] },
      { char: "📚", name: "کتاب‌ها", keywords: ["books", "کتاب"] },
      { char: "✏️", name: "مداد", keywords: ["pencil", "مداد"] },
      { char: "📝", name: "یادداشت", keywords: ["note", "یادداشت"] },
      { char: "💻", name: "لپ‌تاپ", keywords: ["computer", "laptop", "کامپیوتر"] },
      { char: "📱", name: "گوشی موبایل", keywords: ["phone", "موبایل"] },
      { char: "⏰", name: "ساعت زنگ‌دار", keywords: ["alarm", "clock", "ساعت"] },
      { char: "💰", name: "کیف پول", keywords: ["money", "money", "پول"] },
      { char: "🏆", name: "جام", keywords: ["trophy", "cup", "جام"] },
      { char: "🎯", name: "نشان هدف", keywords: ["target", "هدف"] },
    ],
  },
  {
    id: "nature",
    label: "طبیعت",
    icon: "🌸",
    emojis: [
      { char: "🌸", name: "گل شکوفه", keywords: ["flower", "گل"] },
      { char: "🌹", name: "گل رز", keywords: ["rose", "گل"] },
      { char: "🌻", name: "آفتابگردان", keywords: ["sunflower", "گل"] },
      { char: "🌷", name: "گل لاله", keywords: ["tulip", "گل"] },
      { char: "🌳", name: "درخت برگ‌دار", keywords: ["tree", "درخت"] },
      { char: "🍀", name: "چهاربرگ ماست", keywords: ["luck", "شانس"] },
      { char: "🌞", name: "خورشید با چهره", keywords: ["sun", "خورشید"] },
      { char: "🌙", name: "ماه", keywords: ["moon", "ماه"] },
      { char: "⚡", name: "صاعقه", keywords: ["lightning", "صاعقه"] },
      { char: "🌈", name: "رنگین‌کمان", keywords: ["rainbow", "رنگین‌کمان"] },
      { char: "☔", name: "چتر باران", keywords: ["rain", "باران"] },
      { char: "❄️", name: "دانه برف", keywords: ["snow", "برف"] },
    ],
  },
  {
    id: "food",
    label: "غذا",
    icon: "🍕",
    emojis: [
      { char: "🍕", name: "پیتزا", keywords: ["pizza", "پیتزا"] },
      { char: "🍔", name: "همبرگر", keywords: ["burger", "همبرگر"] },
      { char: "🍟", name: "سیب‌زمینی سرخ‌کرده", keywords: ["fries", "چیپس"] },
      { char: "🌭", name: "هات‌داگ", keywords: ["hotdog", "هات‌داگ"] },
      { char: "🌮", name: "تاکو", keywords: ["taco", "تاکو"] },
      { char: "🍣", name: "سوشی", keywords: ["sushi", "سوشی"] },
      { char: "🍦", name: "بستنی", keywords: ["icecream", "بستنی"] },
      { char: "🍰", name: "کیک", keywords: ["cake", "کیک"] },
      { char: "🍫", name: "شکلات", keywords: ["chocolate", "شکلات"] },
      { char: "🍎", name: "سیب قرمز", keywords: ["apple", "سیب"] },
      { char: "🍌", name: "موز", keywords: ["banana", "موز"] },
      { char: "☕", name: "قهوه", keywords: ["coffee", "قهوه"] },
      { char: "🍵", name: "چای", keywords: ["tea", "چای"] },
      { char: "🍷", name: "شراب", keywords: ["wine", "شراب"] },
      { char: "🍺", name: "آبجو", keywords: ["beer", "آبجو"] },
      { char: "🥤", name: "نوشیدنی", keywords: ["cup", "نوشیدنی"] },
    ],
  },
  {
    id: "animals",
    label: "حیوانات",
    icon: "🐱",
    emojis: [
      { char: "🐱", name: "گربه", keywords: ["cat", "گربه"] },
      { char: "🐶", name: "سگ", keywords: ["dog", "سگ"] },
      { char: "🦁", name: "شیر", keywords: ["lion", "شیر"] },
      { char: "🐯", name: "ببر", keywords: ["tiger", "ببر"] },
      { char: "🐴", name: "اسب", keywords: ["horse", "اسب"] },
      { char: "🦓", name: "گورخر", keywords: ["zebra", "گورخر"] },
      { char: "🐮", name: "گاو", keywords: ["cow", "گاو"] },
      { char: "🐷", name: "خوک", keywords: ["pig", "خوک"] },
      { char: "🐸", name: "قورباغه", keywords: ["frog", "قورباغه"] },
      { char: "🐵", name: "میمون", keywords: ["monkey", "میمون"] },
      { char: "🐔", name: "مرغ", keywords: ["chicken", "مرغ"] },
      { char: "🐧", name: "پنگوئن", keywords: ["penguin", "پنگوئن"] },
      { char: "🐦", name: "پرنده", keywords: ["bird", "پرنده"] },
      { char: "🐝", name: "زنبور", keywords: ["bee", "زنبور"] },
      { char: "🦋", name: "پروانه", keywords: ["butterfly", "پروانه"] },
      { char: "🐢", name: "لاک‌پشت", keywords: ["turtle", "لاک‌پشت"] },
    ],
  },
  {
    id: "symbols",
    label: "نمادها",
    icon: "✅",
    emojis: [
      { char: "✅", name: "علامت تیک سبز", keywords: ["check", "تایید"] },
      { char: "❌", name: "ضربدر قرمز", keywords: ["cross", "خط"] },
      { char: "❎", name: "دکمه ضربدر", keywords: ["cross", "خیر"] },
      { char: "✔️", name: "تیک", keywords: ["check", "تایید"] },
      { char: "➕", name: "به‌علاوه", keywords: ["plus", "جمع"] },
      { char: "➖", name: "منها", keywords: ["minus", "تفریق"] },
      { char: "❓", name: "علامت سؤال", keywords: ["question", "سؤال"] },
      { char: "❗", name: "علامت تعجب", keywords: ["exclamation", "تعجب"] },
      { char: "💯", name: "صد", keywords: ["hundred", "صد"] },
      { char: "🚫", name: "ممنوع", keywords: ["prohibited", "ممنوع"] },
      { char: "♻️", name: "نماد بازیافت", keywords: ["recycle", "بازیافت"] },
      { char: "🔔", name: "زنگوله", keywords: ["bell", "زنگ"] },
      { char: "🔔", name: "زنگوله (سکوت)", keywords: ["mute", "سکوت"] },
      { char: "📢", name: "بلندگو", keywords: ["announce", "اطلاعیه"] },
    ],
  },
];

// ----------------------------------------------------------------
// localStorage-backed "recently used" emoji tracking
// ----------------------------------------------------------------

const RECENT_KEY = "emoji-picker-recent";
const MAX_RECENT = 24;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function saveRecent(chars: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(chars.slice(0, MAX_RECENT)));
  } catch {
    // ignore quota / disabled-storage errors
  }
}

// ----------------------------------------------------------------
// The component
// ----------------------------------------------------------------

interface EmojiPickerProps {
  /** Called when the user clicks an emoji. The parent should insert it
   *  at the cursor position in the textarea. */
  onSelect: (emoji: string) => void;
  /** Disable the trigger button (e.g. when the chat is closed). */
  disabled?: boolean;
  /** Optional className for the trigger button. */
  className?: string;
}

export function EmojiPicker({
  onSelect,
  disabled,
  className,
}: EmojiPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState("smileys");
  const [search, setSearch] = React.useState("");
  const [recent, setRecent] = React.useState<string[]>([]);

  // Load recent emojis on mount + when the popover opens.
  React.useEffect(() => {
    if (open) setRecent(loadRecent());
  }, [open]);

  // Compute the emoji list for the current view.
  const visibleEmojis = React.useMemo(() => {
    // If there's a search query, search across ALL categories.
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const all = CATEGORIES.flatMap((c) => c.emojis);
      const seen = new Set<string>();
      const out: EmojiEntry[] = [];
      for (const e of all) {
        if (seen.has(e.char)) continue;
        if (
          e.name.toLowerCase().includes(q) ||
          e.keywords.some((k) => k.toLowerCase().includes(q))
        ) {
          out.push(e);
          seen.add(e.char);
        }
      }
      return out;
    }
    // Otherwise show the active category (or "recent" if it's selected).
    if (activeCategory === "recent") {
      const recentSet = new Set(recent);
      const all = CATEGORIES.flatMap((c) => c.emojis);
      // Preserve the recent order (most-recent first).
      return recent
        .map((char) => all.find((e) => e.char === char))
        .filter((e): e is EmojiEntry => !!e && recentSet.has(e.char));
    }
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    return cat ? cat.emojis : [];
  }, [activeCategory, search, recent]);

  function handleSelect(emoji: string) {
    onSelect(emoji);
    // Update the recent list: prepend the emoji, dedupe, cap at MAX_RECENT.
    setRecent((prev) => {
      const next = [emoji, ...prev.filter((c) => c !== emoji)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn("size-9 shrink-0", className)}
          aria-label="انتخاب ایموجی"
          title="انتخاب ایموجی"
        >
          <Smile className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-80 p-0 sm:w-96"
        // Prevent the popover from closing when the user clicks inside it
        // (the default shadcn popover closes on outside-click; we want the
        // search input to stay focused).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* ---------- Search field ---------- */}
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجوی ایموجی…"
              className="h-9 pl-9 pr-2"
              dir="ltr"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="پاک کردن جستجو"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* ---------- Emoji grid (scrollable) ---------- */}
        <div className="scrollbar-rtl h-64 overflow-y-auto p-2">
          {visibleEmojis.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {activeCategory === "recent" && !search
                ? "هنوز ایموجی استفاده نشده است"
                : "ایموجی یافت نشد"}
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {visibleEmojis.map((e) => (
                <button
                  key={e.char}
                  type="button"
                  onClick={() => handleSelect(e.char)}
                  className="flex size-9 items-center justify-center rounded text-xl transition-transform hover:scale-110 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  title={e.name}
                  aria-label={e.name}
                >
                  <span className="leading-none">{e.char}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---------- Category tabs ---------- */}
        {!search ? (
          <div className="flex items-center gap-0.5 border-t p-1">
            {CATEGORIES.map((c) => {
              const isActive = activeCategory === c.id;
              const isRecent = c.id === "recent";
              // Hide the "recent" tab when there are no recent emojis.
              if (isRecent && recent.length === 0) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center rounded py-1.5 text-lg transition-colors hover:bg-accent",
                    isActive && "bg-accent",
                  )}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={isActive}
                >
                  <span className="leading-none">
                    {isRecent ? "🕘" : c.icon}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
