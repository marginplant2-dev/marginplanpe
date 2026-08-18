"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Calendar, Search } from "lucide-react";
import { PayinOutAPI } from "@/lib/api";
import { Input } from "@/components/ui/input";

type GwSummary = {
  enabled: boolean;
  today_total: string;
  today_count: number;
  week_total: string;
  week_count: number;
};

function inr(v: any): string {
  const n = Number(v ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusPill({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const map: Record<string, string> = {
    APPROVED: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30",
    PENDING: "bg-amber-500/10 text-amber-500 ring-amber-500/30",
    REJECTED: "bg-red-500/10 text-red-500 ring-red-500/30",
    FAILED: "bg-red-500/10 text-red-500 ring-red-500/30",
  };
  const label = s === "APPROVED" ? "SUCCESS" : s;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${map[s] ?? "bg-muted/40 text-muted-foreground ring-border"}`}
    >
      {label}
    </span>
  );
}

/** Divinepay online-payment inbox — a rollup of every gateway (UPI) deposit
 *  with its success/pending state, plus today's & this week's credited totals.
 *  Only rendered for admins the super-admin enabled the gateway for. */
export function GatewayPaymentsPanel({ summary }: { summary?: GwSummary }) {
  const [search, setSearch] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "gateway-deposits", search],
    queryFn: () =>
      PayinOutAPI.deposits({ gateway: true, search: search || undefined, page_size: 100 }),
    refetchInterval: 15_000,
  });
  const items: any[] = data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Today / This week cards — responsive */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <CreditCard className="size-4 text-emerald-500" /> Today's deposits
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-500">
            {inr(summary?.today_total)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {summary?.today_count ?? 0} successful · credited today
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Calendar className="size-4 text-primary" /> This week's deposits
          </div>
          <div className="mt-1.5 text-2xl font-bold text-foreground">
            {inr(summary?.week_total)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {summary?.week_count ?? 0} successful · last 7 days
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client (name / code / mobile)"
          className="h-10 pl-9"
        />
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
              <th className="px-4 py-2.5">Order / UTR</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {isFetching ? "Loading…" : "No online payments yet."}
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.user_name || r.user_code || "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{r.user_code || ""}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">{inr(r.amount)}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px]">{r.gateway_ref || "—"}</div>
                    {r.utr_number ? (
                      <div className="font-mono text-[10px] text-muted-foreground">UTR {r.utr_number}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {isFetching ? "Loading…" : "No online payments yet."}
          </div>
        ) : (
          items.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{r.user_name || r.user_code || "—"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.user_code || ""}</div>
                </div>
                <StatusPill status={r.status} />
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div className="font-mono text-[10px] text-muted-foreground">
                  {r.gateway_ref || "—"}
                  {r.utr_number ? <div>UTR {r.utr_number}</div> : null}
                </div>
                <div className="text-lg font-bold">{inr(r.amount)}</div>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "—"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
