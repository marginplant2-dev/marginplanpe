"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { AnimatedPrice } from "@/components/common/AnimatedPrice";
import { InstrumentIcon } from "./InstrumentIcon";

/** A freshly (re)subscribed token's first tick can be the backend's zero
 *  skeleton. Treat non-positive / non-finite as "no live price yet" so a
 *  cached price is never clobbered by a placeholder 0. */
export function livePrice(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const _EXPIRY_MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/** Compact expiry for a mobile row — `19 AUG`; year appended only when the
 *  contract expires in a different calendar year (`19 JAN 27`). */
export function formatExpiryShort(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const [, y, mo, d] = m;
  const mon = _EXPIRY_MONTHS[Number(mo) - 1];
  if (!mon) return "";
  const label = `${Number(d)} ${mon}`;
  return Number(y) === new Date().getFullYear() ? label : `${label} ${y.slice(2)}`;
}

/** Returns the latest non-null/non-zero value the cell has ever held — keeps
 *  the last good price/percent on screen through a REST/WS hand-off. */
export function useStickyNumber(value: number | null | undefined): number | null {
  const lastGoodRef = useRef<number | null>(null);
  if (value != null && Number.isFinite(value)) {
    lastGoodRef.current = value as number;
  }
  return lastGoodRef.current;
}

/**
 * Single row in a mobile instruments / watchlist list. Pure presentational —
 * every value is pre-resolved by the parent. Supports swipe-left-to-delete
 * when `onDelete` is provided.
 */
export function InstrumentRow({
  token,
  symbol,
  exchange,
  segment,
  expiry,
  bid,
  ask,
  ltp,
  changePct,
  priced = true,
  isActive,
  onSelect,
  rightAction,
  onDelete,
}: {
  token: string;
  symbol: string;
  exchange?: string;
  segment?: string;
  expiry?: string | null;
  bid: number | null;
  ask: number | null;
  ltp: number | null;
  changePct: number | null;
  priced?: boolean;
  isActive: boolean;
  onSelect: () => void;
  rightAction: React.ReactNode;
  onDelete?: () => void;
}) {
  const stickyChange = useStickyNumber(changePct);
  const OPEN = -76;
  const COMMIT = -170;
  const MIN = -300;
  const [dx, setDx] = useState(0);
  const drag = useRef({ startX: 0, startY: 0, baseDx: 0, axis: "" as "" | "h" | "v", moved: false, cur: 0 });
  function onTouchStart(e: React.TouchEvent) {
    if (!onDelete) return;
    const t = e.touches[0];
    drag.current = { startX: t.clientX, startY: t.clientY, baseDx: dx, axis: "", moved: false, cur: dx };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!onDelete) return;
    const t = e.touches[0];
    const dxr = t.clientX - drag.current.startX;
    const dyr = t.clientY - drag.current.startY;
    if (!drag.current.axis && (Math.abs(dxr) > 6 || Math.abs(dyr) > 6)) {
      drag.current.axis = Math.abs(dxr) > Math.abs(dyr) ? "h" : "v";
    }
    if (drag.current.axis !== "h") return;
    drag.current.moved = true;
    const next = Math.max(MIN, Math.min(0, drag.current.baseDx + dxr));
    drag.current.cur = next;
    setDx(next);
  }
  function onTouchEnd() {
    if (!onDelete) return;
    if (drag.current.cur <= COMMIT) {
      setDx(0);
      onDelete();
      return;
    }
    setDx(drag.current.cur < OPEN / 2 ? OPEN : 0);
  }
  const expiryLabel = formatExpiryShort(expiry);
  const rawBid = bid ?? ltp ?? null;
  const rawAsk = ask ?? ltp ?? null;
  const stickyBid = useStickyNumber(rawBid);
  const stickyAsk = useStickyNumber(rawAsk);
  const changeColor =
    stickyChange == null || stickyChange === 0
      ? "text-muted-foreground"
      : stickyChange > 0
        ? "text-emerald-500"
        : "text-red-500";
  return (
    <div
      className={cn(
        "relative overflow-hidden border-b border-border/40",
        onDelete && dx !== 0 && "bg-red-500",
      )}
    >
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDx(0);
            onDelete();
          }}
          aria-label={`Remove ${symbol}`}
          className="absolute inset-y-0 right-0 flex w-[76px] items-center justify-center bg-red-500 text-white"
        >
          <Trash2 className="size-5" />
        </button>
      )}
      <div
        role="button"
        tabIndex={0}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (dx !== 0) {
            setDx(0);
            return;
          }
          if (drag.current.moved) return;
          onSelect();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        style={{ transform: `translateX(${dx}px)`, transition: "transform .18s ease" }}
        className={cn(
          "relative z-[1] grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-xs",
          isActive ? "bg-primary/10" : "bg-background hover:bg-muted/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <InstrumentIcon
            symbol={symbol}
            isCrypto={/^CRYPTO/i.test(segment || "")}
            isForex={/^FOREX/i.test(segment || "")}
            changePct={changePct}
            size={28}
          />
          <div className="flex min-w-0 flex-col items-start leading-tight">
            <span
              className={cn(
                "max-w-full truncate text-[13px] font-bold tracking-tight",
                isActive && "text-primary",
              )}
            >
              {symbol}
            </span>
            <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
              {priced && (
                <span
                  className={cn(
                    "font-tabular tabular-nums text-[11px] font-semibold",
                    changeColor,
                  )}
                >
                  {stickyChange != null
                    ? `${stickyChange >= 0 ? "+" : ""}${stickyChange.toFixed(2)}%`
                    : "—"}
                </span>
              )}
              {expiryLabel && (
                <span className="truncate text-[11px] font-medium uppercase text-muted-foreground">
                  {expiryLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {!priced ? (
          <span className="text-[11px] font-medium text-muted-foreground">Tap +</span>
        ) : (
          <div className="flex flex-col items-end leading-tight">
            {/^(FOREX|STOCKS|INDICES|COMMODIT|METAL|ENERGY|CRYPTO)/i.test(
              String(segment || ""),
            ) ? (
              <>
                <AnimatedPrice
                  value={stickyBid}
                  glide
                  flash
                  format={(n) => formatPrice(n, segment, exchange)}
                  className="whitespace-nowrap font-tabular tabular-nums text-sm font-bold text-red-500"
                />
                <AnimatedPrice
                  value={stickyAsk}
                  glide
                  flash
                  format={(n) => formatPrice(n, segment, exchange)}
                  className="mt-0.5 whitespace-nowrap font-tabular tabular-nums text-sm font-bold text-emerald-500"
                />
              </>
            ) : (
              <>
                <span className="whitespace-nowrap font-tabular tabular-nums text-sm font-bold text-red-500">
                  {stickyBid != null ? formatPrice(stickyBid, segment, exchange) : "—"}
                </span>
                <span className="mt-0.5 whitespace-nowrap font-tabular tabular-nums text-sm font-bold text-emerald-500">
                  {stickyAsk != null ? formatPrice(stickyAsk, segment, exchange) : "—"}
                </span>
              </>
            )}
          </div>
        )}

        {rightAction}
      </div>
    </div>
  );
}
