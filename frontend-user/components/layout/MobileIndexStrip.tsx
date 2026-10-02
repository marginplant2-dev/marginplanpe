"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Wallet, X } from "lucide-react";
import { InstrumentAPI, WalletAPI } from "@/lib/api";
import { useMarketStream } from "@/lib/useMarketStream";
import { cn, formatINR } from "@/lib/utils";
import { readWalletSnapshot } from "@/lib/walletSnapshot";

// Zerodha-style index ticker strip for the mobile header: NIFTY 50 + NIFTY
// BANK, live, colour-coded, with a chevron that opens an "Overview" sheet
// showing the indices plus the wallet balance. Reuses MarketOverview's
// plumbing (search → quotesBatch seed → useMarketStream) + the last_ltp
// fallback so it still shows numbers when the feed is down / market is shut.
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

// 52-week daily-close trend line, Zerodha-style: a single flat blue line.
function Sparkline({ token, open }: { token: string; open: boolean }) {
  const { data } = useQuery<any[]>({
    queryKey: ["index-spark", token],
    queryFn: () => InstrumentAPI.history(token, "day", 365),
    enabled: open && !!token,
    staleTime: 30 * 60_000,
  });
  const closes = useMemo(
    () => (data ?? []).map((c: any) => Number(c?.close ?? 0)).filter((n) => n > 0),
    [data],
  );
  if (closes.length < 2) return <div className="mt-2 h-9" />;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 140;
  const H = 36;
  const pts = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - ((c - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-9 w-full" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="#4184f3"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Resolve an index quote to { ltp, change, pct } with the last-close fallback.
function resolveQuote(q: any): { ltp: number; change: number; pct: number } {
  const live = Number(q?.ltp ?? 0);
  const last = Number(q?.last_ltp ?? 0);
  const prev = Number(q?.prev_close ?? 0);
  const ltp = live > 0 ? live : last;
  let pct = Number(q?.change_pct ?? 0);
  let change = Number(q?.change ?? 0);
  if (live <= 0 && last > 0 && prev > 0) {
    change = last - prev;
    pct = (change / prev) * 100;
  }
  return { ltp, change, pct };
}

export function MobileIndexStrip() {
  const [open, setOpen] = useState(false);

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

  // Wallet balance for the Overview sheet (shares cache with the TopBar pill).
  const { data: wallet } = useQuery({
    queryKey: ["wallet", "summary"],
    queryFn: () => WalletAPI.summary(),
    placeholderData: () => readWalletSnapshot(),
    enabled: open,
  });
  const balance = Number(wallet?.available_balance ?? 0);

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {items.map((it) => {
          const { ltp, pct } = resolveQuote(quoteByToken.get(String(it.token)));
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

      {/* Chevron → Overview sheet */}
      <button
        type="button"
        aria-label="Market overview"
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted/50"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* Backdrop — starts BELOW the header so the index strip stays clear
              (not dimmed) and the sheet connects flush to it, no dark gap. */}
          <div
            className="fixed inset-x-0 bottom-0 z-30 bg-black/30"
            style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
            onClick={() => setOpen(false)}
          />
          {/* Sheet, flush under the header strip */}
          <div
            className="fixed inset-x-0 z-40 max-h-[70vh] overflow-y-auto rounded-b-2xl bg-card shadow-xl"
            style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-sm font-bold">Overview</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted/50"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Indices — plain two-column layout, Zerodha-style (no boxes) */}
            <div className="grid grid-cols-2 gap-x-5 px-4 py-2">
              {items.map((it) => {
                const { ltp, change, pct } = resolveQuote(quoteByToken.get(String(it.token)));
                const up = pct >= 0;
                return (
                  <Link
                    key={it.token}
                    href={`/terminal?token=${it.token}`}
                    onClick={() => setOpen(false)}
                    className="block"
                  >
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {it._short}
                    </div>
                    <div className="mt-1 font-tabular text-xl font-bold tabular-nums text-foreground">
                      {ltp > 0 ? fmt(ltp) : "—"}
                    </div>
                    {ltp > 0 && (
                      <div
                        className={cn(
                          "mt-0.5 flex items-baseline gap-2 font-tabular text-[12px] font-medium tabular-nums",
                          up ? "text-emerald-500" : "text-red-500",
                        )}
                      >
                        <span>
                          {up ? "+" : ""}
                          {change.toFixed(2)}
                        </span>
                        <span>
                          {up ? "+" : ""}
                          {pct.toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <Sparkline token={String(it.token)} open={open} />
                  </Link>
                );
              })}
            </div>
            <p className="px-4 pb-1 text-[11px] italic text-muted-foreground">
              * Charts indicate 52 weeks trend
            </p>

            <div className="mx-4 my-2 border-t border-border" />

            {/* Funds / wallet balance — plain block like Zerodha's "Funds" */}
            <Link
              href="/wallet"
              onClick={() => setOpen(false)}
              className="mx-4 mb-4 mt-1 block"
            >
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <Wallet className="size-4 text-primary" /> Available Balance
              </div>
              <div className="mt-1 font-tabular text-lg font-bold tabular-nums text-primary">
                {formatINR(balance)}
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
