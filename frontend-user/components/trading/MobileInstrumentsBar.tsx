"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MobileOptionChain } from "@/components/trading/MobileOptionChain";
import { MobileWatchlist } from "./MobileWatchlist";

interface Props {
  activeToken: string | null;
  /** `seed` carries the row's last-known ltp/bid/ask + identity so the trade
   *  card paints a price AND a usable instrument instantly. */
  onSelect: (
    token: string,
    seed?: {
      ltp?: number | null;
      bid?: number | null;
      ask?: number | null;
      symbol?: string | null;
      exchange?: string | null;
      segment?: string | null;
    },
  ) => void;
}

/**
 * Mobile instruments panel at the top of the markets/terminal page. Two top
 * tabs:
 *   • Watchlist — Zerodha-style multi-watchlist + "Add scripts" search picker
 *     (see MobileWatchlist). The user curates their own lists; nothing is
 *     browsed by default.
 *   • Options — the existing Groww/Upstox-style option chain (MobileOptionChain,
 *     untouched).
 */
export function MobileInstrumentsBar({ activeToken, onSelect }: Props) {
  const [view, setView] = useState<"watchlist" | "options">("watchlist");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background md:rounded-lg md:border md:border-border md:bg-card">
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-3 py-2">
        {(["watchlist", "options"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className="relative py-0.5">
            <span
              className={cn(
                "text-sm font-bold transition-colors",
                view === v ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "watchlist" ? "Watchlist" : "Options"}
            </span>
            {view === v && (
              <span className="absolute -bottom-[9px] left-0 right-0 h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        ))}
      </div>

      {view === "options" ? (
        <MobileOptionChain onSelect={onSelect} />
      ) : (
        <MobileWatchlist activeToken={activeToken} onSelect={onSelect} />
      )}
    </div>
  );
}
