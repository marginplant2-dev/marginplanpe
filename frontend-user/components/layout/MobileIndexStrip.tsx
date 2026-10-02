"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { InstrumentAPI } from "@/lib/api";
import { useMarketStream } from "@/lib/useMarketStream";
import { cn } from "@/lib/utils";

// Zerodha-style index ticker strip for the mobile header: NIFTY 50 + NIFTY
// BANK, live, colour-coded. Reuses the same plumbing as MarketOverview
// (search → quotesBatch seed → useMarketStream) + the last_ltp fallback so it
// still shows numbers when the feed is down / market is shut.
const INDICES: { q: string; short: string; match: string[] }[] = [
  { q: "NIFTY 50", short: "NIFTY 50", match: ["NIFTY 50", "NIFTY"] },
  { q: "NIFTY BANK", short: "NIFTY BANK", match: ["NIFTY BANK", "BANKNIFTY"] },
];

function pickBestMatch(hits: any[], wanted: string[]): any | null {
  if (!hits.length) return null;
  const W = wanted.map((s) => s.toUpperCase());
  const sym = (h: any) => String(h?.symbol ?? "").toUpperCase();
  return (
    hits.find((h) => W.includes(sym(h)) && !h.expiry) ??
    hits.find((h) => W.includes(sym(h))) ??
    hits.find((h) => !h.expiry) ??
    hits[0]
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MobileIndexStrip() {
  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["index-strip", "resolve"],
    queryFn: async () => {
      const resolved = await Promise.all(
        INDICES.map(async (w) => {
          try {
            const hits = await InstrumentAPI.search(w.q, undefined, undefined, 12);
            const pick = pickBestMatch(hits ?? [], w.match);
            return pick ? { ...pick, _short: w.short } : null;
          } catch {
            return null;
          }
        }),
      );
      return resolved.filter(Boolean) as any[];
    },
    staleTime: 5 * 60_000,
  });

  const tokens = useMemo(() => items.map((i) => String(i.token)), [items]);
  const tokensKey = tokens.join(",");

  const { data: seed } = useQuery<any[]>({
    queryKey: ["index-strip-seed", tokensKey],
    queryFn: () => InstrumentAPI.quotesBatch(tokens),
    enabled: tokens.length > 0,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const stream = useMarketStream(tokens);
  const quoteByToken = useMemo(() => {
    const m = new Map<string, any>();
    for (const q of seed ?? []) m.set(String(q.token), q);
    stream.forEach((q, t) => m.set(t, q));
    return m;
  }, [seed, stream]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
      {items.map((it) => {
        const q = quoteByToken.get(String(it.token));
        const live = Number(q?.ltp ?? 0);
        const last = Number(q?.last_ltp ?? 0);
        const prev = Number(q?.prev_close ?? 0);
        const ltp = live > 0 ? live : last;
        let pct = Number(q?.change_pct ?? 0);
        if (live <= 0 && last > 0 && prev > 0) pct = ((last - prev) / prev) * 100;
        const up = pct >= 0;
        return (
          <Link
            key={it.token}
            href={`/terminal?token=${it.token}`}
            className="flex min-w-0 flex-col leading-none"
          >
            <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {it._short}
            </span>
            <span className="mt-0.5 flex items-baseline gap-1">
              <span className="font-tabular text-[13px] font-bold tabular-nums">
                {ltp > 0 ? fmt(ltp) : "—"}
              </span>
              {ltp > 0 && (
                <span
                  className={cn(
                    "font-tabular text-[10px] font-semibold tabular-nums",
                    up ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  {up ? "+" : ""}
                  {pct.toFixed(2)}%
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
