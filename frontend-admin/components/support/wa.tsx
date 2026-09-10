"use client";

/**
 * WhatsApp-style chat primitives for the Support Chat surface.
 *
 * These deliberately DO NOT use the app's Tailwind theme tokens. The global
 * palette is locked (see CLAUDE.md) and this is a scoped, operator-requested
 * exception: the chat pane is meant to read as a messenger, not as the rest
 * of the admin panel. Every colour here is a literal, confined to these
 * components, so the locked tokens elsewhere are untouched.
 *
 * The light/dark pairs are the two WhatsApp Web palettes:
 *   panel  #ffffff / #111b21    header   #f0f2f5 / #202c33
 *   paper  #efeae2 / #0b141a    incoming #ffffff / #202c33
 *   outgoing #d9fdd3 / #005c4b  ticks    #53bdeb (both)
 *
 * The wallpaper doodle is our own generic SVG, not WhatsApp artwork.
 */

import { Check, CheckCheck, Paperclip } from "lucide-react";
import { API_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const WA = {
  panel: "bg-white dark:bg-[#111b21]",
  header: "bg-[#f0f2f5] dark:bg-[#202c33]",
  border: "border-[#e9edef] dark:border-[#2a3942]",
  text: "text-[#111b21] dark:text-[#e9edef]",
  sub: "text-[#667781] dark:text-[#8696a0]",
  hover: "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]",
  active: "bg-[#f0f2f5] dark:bg-[#2a3942]",
} as const;

/** Server-relative upload path → absolute. Same rule DepositsPanel uses. */
export function fileUrl(u: string): string {
  return u.startsWith("http") ? u : `${API_URL}${u}`;
}

export function isImage(name: string | null, url: string | null): boolean {
  return /\.(png|jpe?g|webp|gif)$/.test((name || url || "").toLowerCase());
}

export function isAudio(name: string | null, url: string | null): boolean {
  return /\.(webm|m4a|mp3|ogg|oga|wav|aac)$/.test((name || url || "").toLowerCase());
}

/** Bubble clock — IST, no date (the date lives on the day chip). */
export function waTime(v: string | null): string {
  if (!v) return "";
  return new Date(v)
    .toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

export function waDayLabel(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  const key = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const now = new Date();
  const yest = new Date(now.getTime() - 86_400_000);
  if (key(d) === key(now)) return "TODAY";
  if (key(d) === key(yest)) return "YESTERDAY";
  return d
    .toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

/** Conversation-list stamp: clock today, date otherwise — keeps the column narrow. */
export function waListTime(v: string | null): string {
  if (!v) return "";
  const label = waDayLabel(v);
  if (label === "TODAY") return waTime(v);
  if (label === "YESTERDAY") return "Yesterday";
  return new Date(v).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// ── WhatsApp glyph ────────────────────────────────────────────────────
// Meta's mark, used ONLY on affordances that actually open WhatsApp
// (wa.me links). It is deliberately never used to label the in-app chat:
// showing it there would tell the user they are in WhatsApp when they are
// not. In-app entry points use ChatGlyph below.
export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
    </svg>
  );
}

/** Our own chat mark for the in-app support thread — a filled speech bubble
 *  in the same messenger green, so the two entry points read as siblings
 *  without either one claiming to be the other. */
export function ChatGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 2C6.477 2 2 6.03 2 11c0 2.64 1.27 5.01 3.29 6.63L4.2 21.3a.55.55 0 0 0 .76.65l4.1-1.87c.93.24 1.92.37 2.94.37 5.523 0 10-4.03 10-9s-4.477-9-10-9Zm-4 10.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────
// WhatsApp shows a photo; we have none, so a deterministic coloured disc
// with initials. Deterministic (hash of the id) so the same user keeps the
// same colour across reloads and across the two panes.
const AVATAR_COLORS = [
  "#e17076", "#7bc862", "#65aadd", "#a695e7",
  "#ee7aae", "#6ec9cb", "#faa774", "#b3b3b3",
];

export function waInitials(name: string, code: string): string {
  const src = (name || code || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function WaAvatar({
  name,
  code,
  id,
  size = 49,
}: {
  name: string;
  code: string;
  id: string;
  size?: number;
}) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return (
    <span
      className="flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.36 }}
      aria-hidden
    >
      {waInitials(name, code)}
    </span>
  );
}

// ── Wallpaper ─────────────────────────────────────────────────────────
// Our own doodle: generic outline glyphs, not WhatsApp's artwork. Two
// variants because the stroke has to invert between the light paper
// (#efeae2) and the dark one (#0b141a).
const DOODLE_LIGHT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='.055' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='34' cy='32' r='11'/%3E%3Cpath d='M92 20h34v22h-24l-10 10z'/%3E%3Cpath d='M182 18l9 16-9 16-9-16z'/%3E%3Cpath d='M28 96h26M28 108h38'/%3E%3Ccircle cx='120' cy='104' r='9'/%3E%3Cpath d='M196 88v34M179 105h34'/%3E%3Cpath d='M40 172l11 11 20-24'/%3E%3Cpath d='M112 160h36v24h-24l-8 10z'/%3E%3Ccircle cx='200' cy='182' r='12'/%3E%3Cpath d='M62 62c8-9 18-9 26 0'/%3E%3Cpath d='M148 214h30'/%3E%3C/g%3E%3C/svg%3E";
const DOODLE_DARK = DOODLE_LIGHT.replace("stroke='%23000'", "stroke='%23fff'").replace(
  "stroke-opacity='.055'",
  "stroke-opacity='.05'",
);

/** Injected once per pane. A `<style>` tag rather than inline styles because
 *  the dark variant needs a `.dark &` selector, which inline style can't do. */
export function WaWallpaperStyles() {
  return (
    <style>{`
      .wa-paper{background-color:#efeae2;background-image:url("${DOODLE_LIGHT}");background-size:240px;background-repeat:repeat}
      .dark .wa-paper{background-color:#0b141a;background-image:url("${DOODLE_DARK}")}
      .wa-scroll::-webkit-scrollbar{width:6px}
      .wa-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2);border-radius:3px}
      .dark .wa-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16)}
    `}</style>
  );
}

// ── Day chip ──────────────────────────────────────────────────────────
export function WaDayChip({ label }: { label: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-lg bg-[#ffffff] px-3 py-1 text-[12.5px] font-medium uppercase tracking-wide text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
        {label}
      </span>
    </div>
  );
}

// ── Ticks ─────────────────────────────────────────────────────────────
export function WaTicks({ read }: { read: boolean }) {
  return read ? (
    <CheckCheck className="h-[15px] w-[15px] shrink-0 text-[#53bdeb]" />
  ) : (
    <Check className="h-[15px] w-[15px] shrink-0 text-[#667781] dark:text-[#8696a0]" />
  );
}

// ── Bubble ────────────────────────────────────────────────────────────
export type WaMessage = {
  id: string;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  read_at: string | null;
  created_at: string | null;
  sender_name?: string;
};

export function WaBubble({
  m,
  mine,
  tail,
  senderLabel,
}: {
  m: WaMessage;
  /** Right-aligned green bubble. Which SIDE is "mine" differs between the
   *  user app (USER) and the admin app (ADMIN) — the caller decides. */
  mine: boolean;
  /** Only the first bubble of a consecutive run gets the tail, exactly like
   *  WhatsApp; the rest sit flush so a run reads as one block. */
  tail: boolean;
  /** Shown above the text on grouped/multi-operator threads. */
  senderLabel?: string | null;
}) {
  const hasImage = isImage(m.attachment_name, m.attachment_url);
  const hasAudio = isAudio(m.attachment_name, m.attachment_url);
  return (
    <div className={cn("flex px-[3%] py-[1px]", mine ? "justify-end" : "justify-start")}>
      {/* Flex-wrap layout, NOT an absolutely-positioned stamp over a spacer.
          The spacer trick needs the reserved width to be at least as wide as
          the rendered time+ticks at every font and locale, and when it isn't
          the stamp prints straight through the last word. Here the stamp is a
          real flex item: it shares the last line when there's room and drops
          to its own right-aligned line when there isn't, so it can never
          overlap regardless of message length. */}
      <div
        className={cn(
          "relative flex max-w-[85%] flex-wrap items-end justify-end gap-x-[8px] rounded-[7.5px] px-[9px] pb-[6px] pt-[6px] text-[14.2px] leading-[19px] shadow-[0_1px_.5px_rgba(11,20,26,.13)] sm:max-w-[65%]",
          mine
            ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]"
            : "bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]",
          tail && (mine ? "rounded-tr-none" : "rounded-tl-none"),
        )}
      >
        {/* CSS-triangle tail. Colour is duplicated per side/theme because a
            border colour can't be inherited from the parent background. */}
        {tail && (
          <span
            aria-hidden
            className={cn(
              "absolute top-0 h-0 w-0 border-b-[8px] border-b-transparent",
              mine
                ? "-right-[8px] border-l-[8px] border-l-[#d9fdd3] dark:border-l-[#005c4b]"
                : "-left-[8px] border-r-[8px] border-r-white dark:border-r-[#202c33]",
            )}
          />
        )}

        {senderLabel && (
          <p className="w-full text-[12.8px] font-medium leading-[17px] text-[#06cf9c]">
            {senderLabel}
          </p>
        )}

        {m.attachment_url && hasAudio && (
          <audio
            controls
            preload="metadata"
            src={fileUrl(m.attachment_url)}
            className="mb-[3px] w-[220px] max-w-full sm:w-[260px]"
          />
        )}

        {m.attachment_url && !hasAudio && (
          <a
            href={fileUrl(m.attachment_url)}
            target="_blank"
            rel="noreferrer"
            className="mb-[3px] block w-full"
          >
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl(m.attachment_url)}
                alt={m.attachment_name || "attachment"}
                className="max-h-[330px] w-full rounded-[6px] object-cover"
              />
            ) : (
              <span className="flex items-center gap-2 rounded-[6px] bg-black/5 px-2 py-2 text-[13px] dark:bg-white/5">
                <Paperclip className="h-4 w-4 shrink-0" />
                <span className="truncate underline">{m.attachment_name || "Attachment"}</span>
              </span>
            )}
          </a>
        )}

        {/* `min-w-0` lets this shrink below its longest line so the text wraps
            INSIDE the bubble; without it a long message would force the bubble
            past its max-width. */}
        {m.body && (
          <span className="min-w-0 whitespace-pre-wrap break-words text-left">
            {m.body}
          </span>
        )}

        <span className="flex shrink-0 items-center gap-[3px] text-[11px] leading-[17px] text-[#667781] dark:text-[#8696a0]">
          {waTime(m.created_at)}
          {mine && <WaTicks read={!!m.read_at} />}
        </span>
      </div>
    </div>
  );
}
