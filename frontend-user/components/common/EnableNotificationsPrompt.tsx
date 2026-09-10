"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import {
  ensureNotificationPermission,
  subscribeForWebPush,
  setUserNotificationsEnabled,
} from "@/lib/notify-sound";
import { useAuthStore } from "@/stores/authStore";

// Shown to logged-in users who haven't granted notification permission yet.
// The Enable button requests permission + subscribes FROM the tap (a real
// user gesture) — the only way iOS PWAs will accept the permission request
// (an automatic request on load is silently rejected by iOS Safari). Android
// already auto-subscribes via UserWsBridge, so those users rarely see this.
const DISMISS_KEY = "mp_notif_prompt_dismissed_at";
const RESHOW_DAYS = 3;

export function EnableNotificationsPrompt() {
  const user = useAuthStore((s) => s.user);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // Granted → the WS bridge already auto-subscribes; nothing to ask.
    // Denied → the browser blocks any re-request, a button can't help.
    if (Notification.permission !== "default") return;
    try {
      const t = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
      if (t && Date.now() - t < RESHOW_DAYS * 864e5) return;
    } catch {
      /* private mode — just show it */
    }
    // Let the page settle so the sheet doesn't fight the first paint.
    const id = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(id);
  }, [user]);

  function remember() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  async function enable() {
    setBusy(true);
    try {
      const ok = await ensureNotificationPermission();
      if (ok) {
        await subscribeForWebPush();
        setUserNotificationsEnabled(true);
      }
    } finally {
      setBusy(false);
      setShow(false);
      remember();
    }
  }

  function dismiss() {
    setShow(false);
    remember();
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[24rem] sm:p-0">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Bell className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Turn on notifications</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Get instant alerts for support replies, deposits, withdrawals and
              important account updates — even when the app is closed.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={enable}
                disabled={busy}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Enabling…" : "Enable notifications"}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40"
              >
                Later
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
