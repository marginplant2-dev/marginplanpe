"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Trophy, Layers, RotateCcw } from "lucide-react";
import { AccountsAPI } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Distinct accent per segment tile so the board reads at a glance.
const SEG_ACCENT: Record<string, string> = {
  NSE_EQ: "bg-sky-500",
  NFO: "bg-violet-500",
  BFO: "bg-fuchsia-500",
  MCX: "bg-amber-500",
  CRYPTO: "bg-orange-500",
  FOREX: "bg-teal-500",
  CDS: "bg-cyan-500",
  OTHER: "bg-slate-500",
};
function accent(seg: string): string {
  return SEG_ACCENT[seg?.toUpperCase()] || "bg-indigo-500";
}
function segLabel(seg: string): string {
  return (seg || "OTHER").replace(/_/g, " ");
}

export default function SegmentPnlPage() {
  // sel: "day" | "week" (current) | "<YYYY-MM-DD>" (a chosen past week)
  const [sel, setSel] = useState<string>("day");

  const { data: weeks } = useQuery({
    queryKey: ["accounts", "weeks"],
    queryFn: () => AccountsAPI.weeks(12),
    staleTime: 60 * 60_000,
  });

  const params = useMemo(
    () =>
      sel === "day"
        ? ({ range: "day" } as const)
        : sel === "week"
          ? ({ range: "week" } as const)
          : ({ range: "week", week_start: sel } as const),
    [sel],
  );

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["segment-pnl", params],
    queryFn: () => AccountsAPI.segmentPnl(params),
    refetchInterval: 30_000,
  });

  const total = Number(data?.total_pnl ?? 0);
  const maxAbs = useMemo(
    () => Math.max(1, ...(data?.segments ?? []).map((s) => Math.abs(Number(s.pnl)))),
    [data?.segments],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Segment P&L"
        description="Where your users are net in profit or loss, by segment — with the day's / week's top movers."
      />

      {/* ── Range selector ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Seg active={sel === "day"} onClick={() => setSel("day")}>
          Today
        </Seg>
        <Seg active={sel === "week"} onClick={() => setSel("week")}>
          This Week
        </Seg>
        <select
          value={sel !== "day" && sel !== "week" ? sel : ""}
          onChange={(e) => setSel(e.target.value || "week")}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Select a week…</option>
          {(weeks ?? []).map((w) => (
            <option key={w.start} value={w.start}>
              {w.start} → {w.end}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted/40"
          aria-label="Refresh"
        >
          <RotateCcw className={cn("size-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* ── Headline total ── */}
      <Card
        className={cn(
          "overflow-hidden border-0 text-white",
          total >= 0
            ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
            : "bg-gradient-to-br from-rose-500 to-rose-600",
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider opacity-90">
            {total >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            Net client P&L · {data?.label ?? "—"}
          </div>
          <div className="mt-1 font-tabular text-3xl font-bold tabular-nums">
            {total >= 0 ? "+" : ""}
            {formatINR(total)}
          </div>
          <div className="mt-1 text-xs opacity-90">
            {total >= 0 ? "Users are net in PROFIT" : "Users are net in LOSS"} ·{" "}
            {data?.position_count ?? 0} closed trades
          </div>
          {/* Broker view — reconciles with the Positions "Total of Both". */}
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white/15 p-2.5 text-center backdrop-blur">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-80">Users P&L</div>
              <div className="font-tabular text-sm font-bold tabular-nums">
                {total >= 0 ? "+" : ""}
                {formatINR(total)}
              </div>
            </div>
            <div className="border-x border-white/20">
              <div className="text-[10px] uppercase tracking-wider opacity-80">Brokerage</div>
              <div className="font-tabular text-sm font-bold tabular-nums">
                +{formatINR(Number(data?.total_brokerage ?? 0))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-80">Your Total</div>
              <div className="font-tabular text-sm font-bold tabular-nums">
                {formatINR(Number(data?.total_of_both ?? 0))}
              </div>
            </div>
          </div>
          <div className="mt-1.5 text-[11px] opacity-75">
            Your Total = (users’ P&L inverted) + brokerage — matches Positions “Total of Both”.
          </div>
        </CardContent>
      </Card>

      {/* ── Segment breakdown ── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-primary" /> By segment
          </div>
          {(data?.segments?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No closed trades in this period.
            </div>
          ) : (
            <div className="space-y-3">
              {data!.segments.map((s) => {
                const v = Number(s.pnl);
                const w = Math.round((Math.abs(v) / maxAbs) * 100);
                return (
                  <div key={s.segment}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={cn("size-2.5 rounded-full", accent(s.segment))} />
                        {segLabel(s.segment)}
                        <span className="text-[11px] text-muted-foreground">· {s.trades}</span>
                      </span>
                      <span className="text-right">
                        <span
                          className={cn(
                            "block font-tabular font-semibold tabular-nums",
                            v >= 0 ? "text-emerald-500" : "text-rose-500",
                          )}
                        >
                          {v >= 0 ? "+" : ""}
                          {formatINR(v)}
                        </span>
                        {Number(s.brokerage) > 0 && (
                          <span className="block text-[11px] font-semibold text-foreground/70">
                            Brokerage +{formatINR(Number(s.brokerage))}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", v >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                        style={{ width: `${Math.max(4, w)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Top 5 instruments ── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Trophy className="size-4 text-amber-500" /> Top instruments
          </div>
          {(data?.top_instruments?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {data!.top_instruments.map((t, i) => {
                const v = Number(t.pnl);
                return (
                  <div key={t.symbol + i} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.symbol}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={cn("size-2 rounded-full", accent(t.segment))} />
                          {segLabel(t.segment)} · {t.trades} trades
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-tabular text-sm font-semibold tabular-nums",
                        v >= 0 ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {v >= 0 ? "+" : ""}
                      {formatINR(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border px-4 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}
