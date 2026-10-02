"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Briefcase,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Gift,
  Landmark,
  LineChart,
  Lock,
  Receipt,
  Table2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { DashboardAPI, OrderAPI, PositionAPI, WalletAPI } from "@/lib/api";
import { cn, formatINR, formatPrice, pnlColor } from "@/lib/utils";
import { AddFundsWizard } from "@/components/wallet/AddFundsWizard";
import { MarketOverview } from "@/components/trading/MarketOverview";
import { MobileNews } from "@/components/trading/MobileNews";
import { NumberTicker } from "@/components/dashboard/NumberTicker";
import { AccountHealth } from "@/components/dashboard/AccountHealth";
import { MarketOverviewTV } from "@/components/dashboard/MarketOverviewTV";
import { useHomeTicker } from "@/lib/useSupport";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data: summary } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => DashboardAPI.summary(),
    refetchInterval: 5000,
  });
  const { data: positions } = useQuery({
    queryKey: ["positions", "open"],
    queryFn: () => PositionAPI.open(),
    refetchInterval: 5000,
  });
  const { data: orders } = useQuery({
    queryKey: ["orders", "recent-dashboard"],
    queryFn: () => OrderAPI.list(),
  });
  // Today's P&L comes from the dedicated `/positions/pnl-summary` endpoint —
  // /dashboard/summary used to recompute it inline, but that path:
  //   1. only iterated currently-open positions, so trades CLOSED today were
  //      excluded from "Today's P&L";
  //   2. added each position's LIFETIME `realized_pnl` (not just today's),
  //      inflating the number with old realised slices; and
  //   3. didn't convert USD-quoted (crypto / forex / MCX) P&L to INR,
  //      reading ~83× too small for those users.
  // The pnl-summary endpoint already covers all three correctly and is the
  // same source the terminal's positions strip + PnlSummaryCards use, so the
  // dashboard, terminal and reports views now agree on a single number.
  const { data: pnlSummary } = useQuery({
    queryKey: ["positions", "pnl-summary"],
    queryFn: () => PositionAPI.pnlSummary(),
    refetchInterval: 5000,
  });

  // Add-funds wizard — same 4-step flow as the Wallet page, opened straight
  // from the home Deposit quick-action so users don't have to hop to /wallet.
  const qc = useQueryClient();
  const [depositOpen, setDepositOpen] = useState(false);
  const { data: companyBanks } = useQuery({
    queryKey: ["company-banks"],
    queryFn: () => WalletAPI.companyBanks(),
    staleTime: 5 * 60_000,
  });
  const defaultBank =
    companyBanks?.find((b: any) => b.is_default) ?? companyBanks?.[0];

  const wallet = summary?.wallet ?? {};
  const portfolio =
    Number(wallet.available_balance ?? 0) + Number(wallet.used_margin ?? 0);
  // Bonus credit pool (Bonus Management). Show the FREE (unlocked) portion —
  // it decrements as the user opens trades against it and restores on close.
  const bonus = Number(wallet.bonus_free ?? wallet.credit ?? 0);
  const bonusLocked = Number(wallet.bonus_locked ?? 0);
  // Prefer the canonical pnl-summary value; fall back to the dashboard
  // payload only while the dedicated query is still loading so we don't
  // flash ₹0 on first paint.
  const todayPnl = Number(pnlSummary?.today_pnl ?? summary?.today_pnl ?? 0);
  const todayPct = portfolio ? (todayPnl / portfolio) * 100 : 0;
  // Desktop-only derived bits (mobile view is unchanged).
  const marginUsage =
    portfolio > 0 ? (Number(wallet.used_margin ?? 0) / portfolio) * 100 : 0;
  const hr = new Date().getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";

  const [hideBalance, setHideBalance] = useState(false);

  return (
    <div className="space-y-5">
      {/* ── Announcement ticker (home only, admin-managed) ───────── */}
      <HomeTicker />

      {/* ── Greeting (mobile/tablet — desktop uses the stat-row header) ─ */}
      <header className="flex items-center justify-between lg:hidden">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Welcome back</p>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {user?.full_name?.split(" ")[0] ?? "Trader"} 👋
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {user?.is_demo && <span className="mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">DEMO</span>}
            {user?.user_code}
          </p>
        </div>
      </header>

      {/* ── Hero portfolio card — mobile/tablet only ── */}
      <section
        className="relative overflow-hidden rounded-[18px] p-[18px] text-white shadow-xl lg:hidden"
        style={{
          background: "linear-gradient(135deg,#2563EB,#1D4ED8,#1E40AF)",
          boxShadow: "0 10px 28px rgba(29,78,216,0.35)",
        }}
      >
        {/* Decorative 52-week-style trend chart */}
        <svg
          className="pointer-events-none absolute right-0 top-10 h-28 w-[52%] opacity-90"
          viewBox="0 0 300 110"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="pfLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#38BDF8" />
              <stop offset="1" stopColor="#67E8F9" />
            </linearGradient>
          </defs>
          <path
            d="M0 90 C25 90 30 80 50 78 C70 75 75 60 95 55 C115 50 120 65 140 62 C160 60 165 38 185 32 C205 26 215 42 232 38 C250 34 255 12 275 15 C288 17 292 28 300 20"
            stroke="url(#pfLine)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="275" cy="15" r="9" fill="none" stroke="#38BDF8" strokeWidth="2" opacity="0.5" />
          <circle cx="275" cy="15" r="5" fill="#FFFFFF" />
        </svg>

        {/* Top row */}
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-white/15">
              <Clock className="size-3.5" style={{ color: "#DDEBFF" }} />
            </span>
            <span className="text-sm font-medium" style={{ color: "#DDEBFF" }}>
              Total Portfolio Value
            </span>
            <button
              type="button"
              onClick={() => setHideBalance((v) => !v)}
              aria-label="Toggle balance visibility"
              className="opacity-85 transition hover:opacity-100"
              style={{ color: "#DDEBFF" }}
            >
              {hideBalance ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <button
            onClick={() => setDepositOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold"
          >
            <ArrowDownToLine className="size-3.5" /> Add funds
          </button>
        </div>

        {/* Value */}
        <h2
          className="relative mt-2 font-tabular text-[34px] font-extrabold leading-tight"
          style={{ letterSpacing: "-1px" }}
        >
          {hideBalance ? "₹ ••••••" : formatINR(portfolio)}
        </h2>

        {/* Profit badge */}
        <div
          className="relative mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold"
          style={{ background: "rgba(16,185,129,0.82)" }}
        >
          <TrendingUp className={cn("size-3.5", todayPnl < 0 && "rotate-180")} style={{ color: "#5EEAD4" }} />
          <span>
            {hideBalance ? "•••" : `${todayPnl >= 0 ? "+" : ""}${formatINR(todayPnl)}`}
            {!hideBalance && (
              <span className="font-semibold opacity-90">
                {" "}
                ({todayPct >= 0 ? "+" : ""}
                {todayPct.toFixed(2)}%)
              </span>
            )}
          </span>
          <span className="h-3.5 w-px bg-white/30" />
          <span className="font-semibold">Today</span>
        </div>

        {/* Bottom stats bar — normal flow (not absolute) so the card is only
            as tall as its content; the old absolute bar forced a big pb-28 and
            left ~30% dead space below. */}
        <div
          className="relative mt-3.5 flex items-center rounded-[14px] border py-2"
          style={{ background: "rgba(30,64,175,0.45)", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <PfStat label="Invested" value={hideBalance ? "•••" : formatINR(wallet.used_margin ?? 0)} />
          <div className="h-7 w-px shrink-0 bg-white/15" />
          <PfStat
            label="Total P&L"
            value={hideBalance ? "•••" : `${todayPnl >= 0 ? "+" : "-"}${formatINR(Math.abs(todayPnl))}`}
            positive={todayPnl >= 0}
          />
          <div className="h-7 w-px shrink-0 bg-white/15" />
          <PfStat
            label="Available Margin"
            value={hideBalance ? "•••" : formatINR(wallet.available_free ?? wallet.available_balance ?? 0)}
          />
        </div>
      </section>

      {/* ── Quick actions — mobile/tablet only ─────────────────── */}
      <section className="grid grid-cols-5 gap-2 sm:gap-3 lg:hidden">
        <QuickAction onClick={() => setDepositOpen(true)} icon={ArrowDownToLine} label="Deposit" iconBg="#DBEAFE" iconColor="#2563EB" />
        <QuickAction href="/orders" icon={Receipt} label="Orders" iconBg="#EDE9FE" iconColor="#8B5CF6" />
        <QuickAction href="/positions" icon={Briefcase} label="Positions" iconBg="#D1FAE5" iconColor="#10B981" />
        <QuickAction href="/option-chain" icon={Table2} label="Options" iconBg="#FFEDD5" iconColor="#F97316" />
        <QuickAction href="/marketwatch" icon={LineChart} label="Watchlist" iconBg="#FCE7F3" iconColor="#EC4899" />
      </section>

      {/* Add-funds 4-step wizard — same flow as the Wallet page. */}
      <AddFundsWizard
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        companyBanks={(companyBanks as any[]) ?? []}
        payeeName={defaultBank?.account_holder}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          qc.invalidateQueries({ queryKey: ["my-deposits"] });
          qc.invalidateQueries({ queryKey: ["wallet-summary"] });
          qc.invalidateQueries({ queryKey: ["wallet-txns"] });
        }}
      />

      {/* ── Mobile: live market overview (replaces the stat tiles) ──
          Phones get a live, color-coded market snapshot in place of the
          three small stat tiles — same data plumbing as the terminal's
          instruments panel, ticking via the marketdata WS. */}
      {/* Mobile market panel — now carries Top Gainers / Top Losers / Most
          Active as in-panel tabs, so the separate TopMovers section is gone. */}
      <MarketOverview className="sm:hidden" />

      {/* ── Stat tiles row — desktop only (sm+). Hidden on mobile where
          the MarketOverview above takes their place. ────────────────── */}
      <section className="hidden gap-3 sm:grid sm:grid-cols-3 lg:hidden">
        <StatTile label="Open positions" value={String(summary?.open_positions ?? 0)} hint="live MTM" />
        <StatTile label="Pending orders" value={String(summary?.pending_orders ?? 0)} hint="awaiting fill" />
        <StatTile
          label="Today's P&L"
          value={hideBalance ? "•••" : formatINR(todayPnl)}
          tone={pnlColor(todayPnl)}
        />
      </section>

      {/* ══════════════════════════════════════════════════════════════
          DESKTOP dashboard (lg+). The mobile / tablet view above is
          intentionally untouched — this entire block is lg-only.
          ══════════════════════════════════════════════════════════════ */}
      <div className="hidden space-y-5 lg:block">
        {/* Greeting + 4 stat cards */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">
              {greeting}, {user?.full_name?.split(" ")[0] ?? "Trader"} 👋
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              {user?.is_demo && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  DEMO
                </span>
              )}
              <span>{user?.user_code} · Trade. Earn. Level up.</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BigStat
              icon={Wallet}
              iconClass="bg-primary/10 text-primary"
              label="Portfolio value"
              onToggle={() => setHideBalance((v) => !v)}
              hidden={hideBalance}
            >
              {hideBalance ? "₹ ••••••" : <NumberTicker value={portfolio} format={formatINR} />}
            </BigStat>
            <BigStat
              icon={Activity}
              iconClass={todayPnl >= 0 ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"}
              label="Today's P&L"
              tone={pnlColor(todayPnl)}
            >
              {hideBalance ? "•••" : <NumberTicker value={todayPnl} format={formatINR} />}
            </BigStat>
            <BigStat
              icon={Landmark}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label="Available margin"
            >
              {hideBalance ? (
                "•••"
              ) : (
                <NumberTicker
                  value={Number(wallet.available_free ?? wallet.available_balance ?? 0)}
                  format={formatINR}
                />
              )}
            </BigStat>
            <BigStat
              icon={Lock}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              label="Used margin"
            >
              {hideBalance ? (
                "•••"
              ) : (
                <NumberTicker value={Number(wallet.used_margin ?? 0)} format={formatINR} />
              )}
            </BigStat>
          </div>
        </div>

        {/* Row 1 — Market overview · Open positions · Recent orders */}
        <div className="grid gap-4 lg:grid-cols-3">
          <PanelCard
            title="Market overview"
            subtitle="Indices · Forex · Crypto · Commodities"
            action={{ label: "View all markets", href: "/marketwatch" }}
          >
            <div className="h-[300px] overflow-hidden rounded-xl border border-border [&_iframe]:rounded-xl">
              <MarketOverviewTV />
            </div>
          </PanelCard>

        <PanelCard
          title="Open positions"
          subtitle="Live mark-to-market"
          action={{ label: "View all", href: "/positions" }}
        >
          {positions?.length ? (
            <ul className="divide-y divide-border">
              {positions.slice(0, 6).map((p: any) => {
                const isUp = Number(p.unrealized_pnl) >= 0;
                return (
                  <li key={p.id}>
                    <Link
                      href="/positions"
                      className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "grid size-9 place-items-center rounded-full text-xs font-bold uppercase",
                            isUp ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"
                          )}
                        >
                          {p.symbol?.slice(0, 2)}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{p.symbol}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {p.product_type} · {p.quantity} @ {formatPrice(p.avg_price, p.segment_type, p.exchange)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("font-tabular text-sm font-semibold", pnlColor(p.unrealized_pnl))}>
                          {formatINR(p.unrealized_pnl)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          LTP {formatPrice(p.ltp, p.segment_type, p.exchange)}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState message="No open positions" cta={{ label: "Open a trade", href: "/terminal" }} />
          )}
        </PanelCard>

        <PanelCard
          title="Recent orders"
          subtitle="Last 6 placed"
          action={{ label: "All", href: "/positions" }}
        >
          {orders?.length ? (
            <ul className="divide-y divide-border">
              {orders.slice(0, 6).map((o: any) => {
                const isBuy = String(o.action).toUpperCase() === "BUY";
                return (
                  <li key={o.id}>
                    <Link
                      href="/positions"
                      className="flex items-center justify-between py-2 text-xs transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex w-12 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            isBuy ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"
                          )}
                        >
                          {isBuy ? "BUY" : "SELL"}
                        </span>
                        <span className="font-medium">{o.symbol}</span>
                        <span className="text-muted-foreground">×{o.quantity}</span>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          o.status === "EXECUTED"
                            ? "bg-buy/15 text-buy"
                            : o.status === "REJECTED" || o.status === "CANCELLED"
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {o.status}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState message="No orders yet" cta={{ label: "Place an order", href: "/terminal" }} />
          )}
        </PanelCard>
        </div>

        {/* Row 2 — Market news · Account health */}
        <div className="grid gap-4 lg:grid-cols-3">
          <PanelCard className="lg:col-span-2" title="Market news" subtitle="Live headlines">
            <div className="h-[340px] overflow-hidden rounded-xl border border-border [&_iframe]:rounded-xl">
              <MobileNews />
            </div>
          </PanelCard>
          <PanelCard title="Account health" subtitle="Live risk snapshot">
            <div className="py-4">
              <AccountHealth usedPct={marginUsage} />
            </div>
          </PanelCard>
        </div>
      </div>
    </div>
  );
}

function BigStat({
  icon: Icon,
  iconClass,
  label,
  tone,
  onToggle,
  hidden,
  children,
}: {
  icon: any;
  iconClass: string;
  label: string;
  tone?: string;
  onToggle?: () => void;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition-shadow hover:shadow-md">
      <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", iconClass)}>
        <Icon className="size-5" strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <div className={cn("flex items-center gap-1.5 font-tabular text-[18px] font-bold leading-tight tabular-nums", tone)}>
          {children}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Toggle balance visibility"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2">
      <div className="text-[10px] uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-0.5 font-tabular text-sm font-semibold">{value}</div>
      {hint && <div className="text-[9px] opacity-70">{hint}</div>}
    </div>
  );
}

// Portfolio hero bottom-bar stat (white on the blue card).
function PfStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-1 text-center">
      <div className="truncate text-[9px] font-medium uppercase tracking-wide" style={{ color: "#BFD1FF" }}>
        {label}
      </div>
      <div
        className="mt-0.5 whitespace-nowrap font-tabular text-[12px] font-bold leading-tight"
        style={{ color: positive ? "#22E6C3" : "#FFFFFF" }}
      >
        {value}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  onClick,
  icon: Icon,
  label,
  iconBg,
  iconColor,
}: {
  href?: string;
  onClick?: () => void;
  icon: any;
  label: string;
  iconBg: string;
  iconColor: string;
}) {
  const cls = cn(
    "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2.5 text-[11px] font-semibold transition-all",
    "hover:shadow-md active:scale-95",
  );
  const inner = (
    <>
      <div
        className="grid size-11 place-items-center rounded-xl"
        style={{ background: iconBg }}
      >
        <Icon className="size-5" strokeWidth={2.25} style={{ color: iconColor }} />
      </div>
      <span>{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={cls}>
      {inner}
    </Link>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-tabular text-lg font-semibold", tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function PanelCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            {action.label} <ChevronRight className="size-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message, cta }: { message: string; cta?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-sm text-muted-foreground">{message}</div>
      {cta && (
        <Button asChild variant="outline" size="sm">
          <Link href={cta.href}>
            <ArrowUpRight className="size-3.5" /> {cta.label}
          </Link>
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Home announcement ticker — admin-managed scrolling strip. Renders ONLY
// on this (home) page; other routes never mount it. Hidden when the admin
// has no lines. Seamless loop = content duplicated + translateX 0 → -50%.
// ─────────────────────────────────────────────────────────────────
function HomeTicker() {
  const { data } = useHomeTicker();
  const msgs = (data?.messages ?? []).filter((m) => m && m.trim());
  if (msgs.length === 0) return null;
  // One continuous string with a bullet between EVERY line INCLUDING the wrap
  // (trailing separator) so the loop seam reads the same as any other gap — the
  // text joins directly, no big carve between repeats.
  const sep = " • "; // em-space · bullet · em-space
  const content = msgs.join(sep) + sep;
  const dur = Math.max(16, Math.round(content.length * 0.3));
  // Soft fade at both inner edges so the scroll blends into the box instead of
  // hard-cutting at the border ("carve"). Kept inside the rounded container.
  const fade =
    "linear-gradient(to right, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%)";
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-primary/25 bg-primary/5"
      style={{ WebkitMaskImage: fade, maskImage: fade }}
    >
      <div
        className="mp-ticker-track flex w-max whitespace-nowrap py-1.5 text-[13px] font-semibold text-primary"
        style={{ animationDuration: `${dur}s` }}
      >
        <span>{content}</span>
        <span aria-hidden>{content}</span>
      </div>
      <style>{`
        .mp-ticker-track { animation: mp-ticker linear infinite; }
        .mp-ticker-track:hover { animation-play-state: paused; }
        @keyframes mp-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
    </div>
  );
}
