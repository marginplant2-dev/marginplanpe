"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Scale, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LedgerAdminAPI, UsersAPI } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  user:
    | {
        id: string;
        user_code?: string;
        full_name?: string;
        wallet?: { available_balance?: string | number };
      }
    | null;
}

const PAGE_SIZE = 15;

function formatINR(v: unknown): string {
  const n = Number(v ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Mongo timestamps are naive-UTC — pin Z before formatting to IST.
function fmtDate(v: unknown): string {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// The 4 categories the ledger shows: real deposits/withdrawals + admin
// add/deduct (ADJUSTMENT ± and the bonus/penalty/promo admin credits).
const SHOWN = new Set(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT", "BONUS", "PENALTY", "PROMO"]);

function txLabel(tt: string, amt: number): string {
  switch (tt) {
    case "DEPOSIT": return "Deposit";
    case "WITHDRAWAL": return "Withdrawal";
    case "ADJUSTMENT": return amt >= 0 ? "Admin Add" : "Admin Deduct";
    case "BONUS": return "Bonus (Admin)";
    case "PENALTY": return "Penalty (Admin)";
    case "PROMO": return "Promo (Admin)";
    default: return tt;
  }
}

export function LedgerSheet({ open, onClose, user }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "ledger", "user", user?.id],
    queryFn: () => LedgerAdminAPI.list({ user_id: user!.id, page: 1, page_size: 1000 }),
    enabled: !!user && open,
  });

  const { data: liveUser } = useQuery({
    queryKey: ["admin", "user", user?.id],
    queryFn: () => UsersAPI.detail(user!.id),
    enabled: !!user && open,
  });

  const liveBalance = liveUser?.wallet?.available_balance ?? user?.wallet?.available_balance;

  const txns: any[] = (data?.items ?? []).filter((t: any) =>
    SHOWN.has(String(t?.transaction_type ?? "").toUpperCase()),
  );

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const t of txns) {
    const amt = Number(t?.amount ?? 0);
    if (amt >= 0) totalDeposits += amt;
    else totalWithdrawals += Math.abs(amt);
  }
  const net = totalDeposits - totalWithdrawals;

  const visibleTxns = txns.slice(0, visibleCount);
  const remaining = txns.length - visibleCount;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setVisibleCount(PAGE_SIZE);
        }
      }}
    >
      <DialogContent className="w-[96vw] max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Ledger — {user?.full_name || user?.user_code || ""}
          </DialogTitle>
          <DialogDescription>Deposits, withdrawals &amp; admin adjustments</DialogDescription>
        </DialogHeader>

        {/* Available balance */}
        <div className="rounded-xl border border-border bg-gradient-to-br from-primary/10 to-transparent p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Wallet className="size-3.5" /> Available Balance
          </div>
          <div className="mt-1 font-tabular text-2xl font-bold tabular-nums">{formatINR(liveBalance)}</div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile
            label="Total Deposits"
            sub="deposits + admin add"
            value={formatINR(totalDeposits)}
            tone="up"
            icon={<ArrowDownLeft className="size-3.5" />}
          />
          <SummaryTile
            label="Total Withdrawals"
            sub="withdraw + admin deduct"
            value={formatINR(totalWithdrawals)}
            tone="down"
            icon={<ArrowUpRight className="size-3.5" />}
          />
          <SummaryTile
            label="Net"
            sub="deposits − withdrawals"
            value={formatINR(net)}
            tone={net >= 0 ? "up" : "down"}
            icon={<Scale className="size-3.5" />}
          />
        </div>

        {/* Transactions */}
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            All Transactions ({txns.length})
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : txns.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</div>
          ) : (
            <>
              <div className="space-y-1.5">
                {visibleTxns.map((t: any) => {
                  const amt = Number(t.amount ?? 0);
                  const tt = String(t?.transaction_type ?? "").toUpperCase();
                  const up = amt >= 0;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div
                        className={`grid size-9 shrink-0 place-items-center rounded-full ${
                          up ? "bg-emerald-500/12 text-emerald-500" : "bg-red-500/12 text-red-500"
                        }`}
                      >
                        {up ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                      </div>
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-sm font-semibold">{txLabel(tt, amt)}</div>
                        <div className="truncate text-xs text-muted-foreground">{t.narration || "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtDate(t.created_at)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-tabular text-sm font-bold tabular-nums ${
                            up ? "text-emerald-500" : "text-red-500"
                          }`}
                        >
                          {up ? "+" : "−"}
                          {formatINR(Math.abs(amt))}
                        </div>
                        {t.balance_after != null && (
                          <div className="text-[10px] text-muted-foreground">bal {formatINR(t.balance_after)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {remaining > 0 && (
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  <ChevronDown className="size-4" />
                  Load {Math.min(PAGE_SIZE, remaining)} more
                  <span className="opacity-60">({remaining} left)</span>
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  label,
  sub,
  value,
  tone,
  icon,
}: {
  label: string;
  sub: string;
  value: string;
  tone: "up" | "down";
  icon: ReactNode;
}) {
  const color = tone === "up" ? "text-emerald-500" : "text-red-500";
  const ring = tone === "up" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5";
  return (
    <div className={`rounded-xl border p-2.5 ${ring}`}>
      <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className={color}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 font-tabular text-sm font-bold tabular-nums sm:text-base ${color}`}>{value}</div>
      <div className="mt-0.5 hidden text-[9px] text-muted-foreground sm:block">{sub}</div>
    </div>
  );
}
