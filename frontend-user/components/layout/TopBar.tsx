"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Bell, LogOut, Megaphone, Search, User as UserIcon, Wallet } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { api, unwrap, SupportChatAPI, WalletAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { NAV_ITEMS } from "@/components/layout/Sidebar";
import { cn, formatINR } from "@/lib/utils";
import { readWalletSnapshot, writeWalletSnapshot } from "@/lib/walletSnapshot";
import { buildWhatsappUrl, useSupportContacts } from "@/lib/useSupport";
import { ChatGlyph, WhatsAppGlyph } from "@/components/support/wa";

/** WhatsApp brand glyph — Lucide doesn't ship the real WhatsApp mark so
 * we inline the official SVG path. Sized to match Lucide's icon
 * dimensions so it lines up with the other header buttons. */
// Core items shown as the centred desktop nav (reference layout). The rest
// (Alerts, Refer & Earn, Profile) live in the profile dropdown on the right.
const PRIMARY_HREFS = new Set([
  "/dashboard",
  "/terminal",
  "/positions",
  "/wallet",
  "/ledger",
  "/reports/tradebook",
]);

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pathname = usePathname();
  // Demo accounts don't get the support-chat system (it routes to a real
  // admin/broker — meaningless for the shared universal demo login).
  const isDemo = !!user?.is_demo;
  const primaryNav = NAV_ITEMS.filter((it) => PRIMARY_HREFS.has(it.href));
  const secondaryNav = NAV_ITEMS.filter(
    (it) => !PRIMARY_HREFS.has(it.href) && !(isDemo && it.href === "/support"),
  );

  // Live wallet balance — drives the pill on the topbar.
  // `placeholderData` paints the last-known balance from localStorage so the
  // pill never flashes ₹0 between login and the first /wallet/summary
  // response. We persist on every fresh fetch so the snapshot stays current
  // across refreshes/tabs.
  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["wallet", "summary"],
    queryFn: async () => {
      const s = await WalletAPI.summary();
      writeWalletSnapshot(s);
      return s;
    },
    refetchInterval: 8000,
    placeholderData: () => readWalletSnapshot(),
  });
  const hasBalance = wallet?.available_balance != null;
  const balance = Number(wallet?.available_balance ?? 0);

  // The app no longer uses `viewport-fit=cover` / `black-translucent`, so iOS
  // reserves the status-bar region itself and `env(safe-area-inset-top)`
  // resolves to 0 in the installed PWA — the header sits at a clean 3.5rem
  // below the OS status bar. The inset terms below are kept as a harmless
  // belt-and-braces in case cover is ever re-enabled. `backdrop-blur` is
  // dropped and a solid bg used
  // instead — a full-width sticky blur bar forces iOS Safari to re-composite
  // the whole viewport every scroll/route frame, which is the iPhone-only
  // jank / "page won't switch" slowness (Android Chrome composites it
  // cheaply). Solid bar = same look, no per-frame GPU cost.
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background px-3 md:px-4"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
      }}
    >
      {/* Mobile-only brand (sidebar is hidden ≤ md) */}
      <div className="md:hidden">
        <BrandLogo size="sm" />
      </div>

      {/* Desktop (lg+) brand — sidebar is hidden at lg, so the logo lives
          in the top nav bar instead. Tablet (md) still uses the sidebar. */}
      <div className="mr-1 hidden shrink-0 lg:flex">
        <BrandLogo size="sm" />
      </div>

      {/* Desktop (lg+) horizontal nav — centred grouped pill, replacing
          the left sidebar. Core items only; the rest sit in the profile
          menu on the right. Uses the same NAV_ITEMS as the sidebar. */}
      <nav className="hidden flex-1 justify-center lg:flex">
        <div className="flex items-center gap-0.5 rounded-full border border-border bg-card/60 p-1">
          {primaryNav.map((it) => {
            const active =
              pathname === it.href ||
              (it.href !== "/dashboard" && pathname?.startsWith(it.href));
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {it.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Search — tablet (md) only; on lg the nav takes the centre. */}
      <div className="relative hidden flex-1 md:block lg:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search RELIANCE, NIFTY, BANKNIFTY…"
          className="h-9 max-w-md pl-9"
          aria-label="Search instruments"
        />
      </div>

      {/* Wallet balance pill — always visible, click → /wallet. While the
          first /wallet/summary is still loading and we have no cached
          snapshot to fall back on, show a dim ellipsis instead of "₹0" so
          the user doesn't briefly think their wallet is empty. */}
      <Link
        href="/wallet"
        className="ml-auto inline-flex max-w-[55vw] items-center gap-1.5 truncate rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 sm:max-w-none sm:gap-2 sm:px-3"
      >
        <Wallet className="size-3.5 shrink-0" />
        <span className="hidden text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
          Wallet
        </span>
        <span
          className={cn(
            "truncate font-tabular",
            !hasBalance && walletLoading && "text-muted-foreground/60",
          )}
        >
          {hasBalance ? formatINR(balance) : walletLoading ? "₹ —" : formatINR(balance)}
        </span>
      </Link>

      {/* Promo button — super-admin-managed blinking CTA. Renders nothing
          unless the super-admin turned it ON with a URL in Platform Settings. */}
      <PromoButton />

      {/* Notification bell — visible on mobile + desktop. */}
      <Button variant="ghost" size="icon" aria-label="Notifications" asChild>
        <Link href="/notifications">
          <Bell className="size-4" />
        </Link>
      </Button>

      {/* Support shortcut — visible on mobile + desktop. Opens WhatsApp when
          the broker published a number, otherwise the in-app chat, so the
          header always has a working way to reach support. */}
      {!isDemo && <SupportShortcut />}

      {/* ── Desktop-only cluster ────────────────────────────────
         ThemeToggle / Profile / Logout. Mobile users get these from
         the Profile bottom-nav tab so the header stays uncluttered. */}
      <div className="hidden items-center gap-1 md:flex">
        <ThemeToggle />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <UserIcon className="size-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-[210px] rounded-xl border border-border bg-card p-1.5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              {user && (
                <div className="px-2.5 py-1.5">
                  <div className="truncate text-sm font-semibold">{user.full_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{user.user_code}</div>
                </div>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              {secondaryNav.map((it) => {
                const Icon = it.icon;
                return (
                  <DropdownMenu.Item key={it.href} asChild>
                    <Link
                      href={it.href}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      {it.label}
                    </Link>
                  </DropdownMenu.Item>
                );
              })}
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item asChild>
                <button
                  type="button"
                  onClick={() => logout().then(() => (window.location.href = "/login"))}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-sell outline-none transition-colors hover:bg-sell/10 focus:bg-sell/10"
                >
                  <LogOut className="size-4" /> Sign out
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}

/**
 * Support shortcut. One slot in the header, two destinations:
 *
 *   - broker published a WhatsApp number  -> WhatsApp mark, opens wa.me
 *   - no number published                 -> chat mark, opens the in-app
 *     support thread, carrying its unread badge
 *
 * The icon follows the destination rather than staying fixed: labelling the
 * in-app thread with WhatsApp's mark would promise an app the tap doesn't
 * open. Either way the affordance is always present — the old version
 * rendered nothing at all when the number was blank, which left users on a
 * broker who hadn't configured one with no way to reach support from here.
 */
function SupportShortcut() {
  const { data: support } = useSupportContacts();
  const waUrl = buildWhatsappUrl(
    support?.whatsapp,
    "Hi, I need help with my MarginPlant account",
  );

  // Only needed for the in-app branch, so don't poll it when WhatsApp wins.
  const { data: chatUnread } = useQuery({
    queryKey: ["support", "chat", "unread"],
    queryFn: () => SupportChatAPI.unread(),
    enabled: !waUrl,
    refetchInterval: 60_000,
  });

  if (waUrl) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Contact support on WhatsApp"
        title="Contact support on WhatsApp"
        asChild
      >
        <a href={waUrl} target="_blank" rel="noopener noreferrer">
          {/* Filled disc rather than a bare 16px outline glyph: at the size a
              ghost icon button gives it, a thin mark reads as decoration and
              users miss it. Solid green + white mark is unmistakable. */}
          <span className="grid size-8 place-items-center rounded-full bg-[#25D366] text-white shadow-sm">
            <WhatsAppGlyph className="size-[19px]" />
          </span>
        </a>
      </Button>
    );
  }

  const unread = chatUnread?.unread ?? 0;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={unread > 0 ? `Support chat, ${unread} unread` : "Support chat"}
      title="Support chat"
      className="relative"
      asChild
    >
      <Link href="/support">
        <span className="grid size-8 place-items-center rounded-full bg-[#25D366] text-white shadow-sm">
          <ChatGlyph className="size-[19px]" />
        </span>
        {/* Badge rides the disc's top-right corner. `ring` in the bar colour
            cuts a gap between badge and disc so the count stays readable
            where the two overlap. */}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[17px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-[17px] text-white ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

/**
 * Promo button — a super-admin-managed blinking CTA in the header, shown to
 * EVERY user. Config comes from Platform Settings (promo.button_*). Renders
 * nothing unless it's enabled AND has a URL, so the header stays clean when
 * it's off. Polls once a minute so an admin toggle propagates without a
 * reload.
 */
type PromoConfig = { enabled: boolean; url: string; label: string };

function PromoButton() {
  const { data } = useQuery<PromoConfig>({
    queryKey: ["promo-button"],
    queryFn: () => unwrap<PromoConfig>(api.get("/user/support/promo")),
    // Short poll + always-refetch-on-mount/focus so a super-admin toggle (esp.
    // turning it OFF) clears within ~10 s and instantly on any nav / tab focus,
    // instead of lingering for a minute. Never persisted stale: refetchOnMount
    // "always" re-checks immediately even after a cache rehydrate.
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  if (!data?.enabled || !data.url) return null;
  const href = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
  const label = (data.label || "Offer").trim() || "Offer";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="inline-flex shrink-0 animate-pulse items-center gap-1 rounded-full bg-gradient-to-r from-orange-500 to-rose-600 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-md shadow-rose-500/40 ring-1 ring-white/30 transition-transform hover:scale-105"
    >
      <Megaphone className="size-3 shrink-0" />
      <span className="max-w-[24vw] truncate sm:max-w-none">{label}</span>
    </a>
  );
}
