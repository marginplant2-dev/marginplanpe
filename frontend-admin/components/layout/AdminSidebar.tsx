"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SupportChatAPI } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAdminAuthStore } from "@/stores/authStore";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { useAdminNav, resolveNavLabel } from "@/components/layout/adminNav";

/**
 * Desktop sidebar. Same look + same permission gating as before;
 * nav config lives in `./adminNav.ts` so the mobile drawer can reuse
 * the exact same source of truth.
 */
export function AdminSidebar() {
  const pathname = usePathname();
  const admin = useAdminAuthStore((s) => s.admin);
  const visible = useAdminNav();

  // Support-chat badge. Gated on the nav item actually being visible so an
  // admin without the `support` permission never fires a request that comes
  // back 403. The AdminWsBridge invalidates this key on every incoming
  // message, so the count moves the moment a user writes in.
  const canSeeChat = visible.some((g) =>
    g.items.some((i) => i.href === "/support-chat"),
  );
  const { data: chatUnread } = useQuery({
    queryKey: ["support-chat", "unread-total"],
    queryFn: () => SupportChatAPI.unreadTotal(),
    enabled: canSeeChat,
    refetchInterval: 60_000,
  });
  const chatBadge = chatUnread?.unread_threads ?? 0;

  return (
    <aside className="sticky top-0 z-30 hidden h-screen w-64 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center border-b border-border px-4">
        <BrandLogo size="sm" />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scrollbar-thin">
        {visible.map((g) => (
          <div key={g.title} className="space-y-1">
            <div className="px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {g.title}
            </div>
            {g.items.map((it) => {
              const active =
                pathname === it.href || pathname?.startsWith(it.href + "/");
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{resolveNavLabel(it, admin)}</span>
                  {it.href === "/support-chat" && chatBadge > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-profit px-1.5 text-[10px] font-semibold text-black">
                      {chatBadge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
