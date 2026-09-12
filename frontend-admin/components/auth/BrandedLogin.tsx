"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ShieldCheck, Handshake } from "lucide-react";
import { useAdminAuthStore } from "@/stores/authStore";
import { ApiError } from "@/lib/api";
import { API_URL, APP_NAME } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { InstallPWAButton } from "@/components/pwa/InstallPWAButton";

const schema = z.object({
  identifier: z.string().min(3, "Enter your email or user code"),
  password: z.string().min(8, "Minimum 8 characters"),
});
type FormValues = z.infer<typeof schema>;

type Variant = "admin" | "broker";
type Branding = { brand_name: string | null; logo_url: string | null } | null;

// Fixed per-role palettes — admin = emerald (platform default vibe), broker =
// indigo, so the two login surfaces are instantly distinguishable. The LOGO +
// name come from the domain's admin (same on both), only the accent differs.
const THEME: Record<Variant, {
  ring: string; grad: string; badge: string; icon: typeof ShieldCheck;
  badgeText: string; title: string; sub: string; tagline: string;
}> = {
  admin: {
    ring: "focus-visible:ring-emerald-500/40",
    grad: "from-emerald-500 via-emerald-600 to-teal-700",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: ShieldCheck,
    badgeText: "Restricted · Admin access",
    title: "Admin Login",
    sub: "Sign in with your admin credentials.",
    tagline: "Manage your users, risk, payments and reports — all in one control panel.",
  },
  broker: {
    ring: "focus-visible:ring-indigo-500/40",
    grad: "from-indigo-500 via-violet-600 to-purple-700",
    badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    icon: Handshake,
    badgeText: "Partner · Broker access",
    title: "Broker Login",
    sub: "Sign in with your broker credentials.",
    tagline: "Track your clients, sub-brokers and P&L sharing — your desk, your numbers.",
  },
};

function currentHost(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname;
}

// Platform host = the un-branded MarginPlant surface. ONLY here may we fall
// back to "MarginPlant" / the default glyph. On any connected tenant domain we
// must never show MarginPlant — use the admin's brand (or the bare domain).
function isPlatformHost(host: string): boolean {
  const h = (host || "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "marginplant.com" ||
    h.endsWith(".marginplant.com")
  );
}

export function BrandedLogin({ variant }: { variant: Variant }) {
  const router = useRouter();
  const login = useAdminAuthStore((s) => s.login);
  const t = THEME[variant];
  const Icon = t.icon;

  const [branding, setBranding] = useState<Branding>(null);

  // Resolve the domain's admin branding BEFORE auth so the tenant sees their
  // own logo + name on the login screen. Best-effort: falls back to the
  // platform default, then to the built-in BrandLogo glyph.
  useEffect(() => {
    let alive = true;
    (async () => {
      const host = currentHost();
      const tryFetch = async (url: string) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) return null;
          const json = await res.json();
          return (json?.data ?? null) as Branding;
        } catch {
          return null;
        }
      };
      let b = host ? await tryFetch(`${API_URL}/api/v1/branding/by-domain?domain=${encodeURIComponent(host)}`) : null;
      if (!b) b = await tryFetch(`${API_URL}/api/v1/branding/platform`);
      if (alive && b) setBranding(b);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Tab title + favicon + install manifest → the admin's brand (same on the
  // broker page — operator: the broker's PWA logo is the admin's logo).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const name = (branding?.brand_name || "").trim();
    const logo = branding?.logo_url
      ? branding.logo_url.startsWith("http")
        ? branding.logo_url
        : `${API_URL}${branding.logo_url}`
      : null;
    // On a connected tenant domain NEVER fall back to "MarginPlant": use the
    // brand, else the bare domain, else just the role title.
    const platform = isPlatformHost(currentHost());
    const forTitle = name || (platform ? APP_NAME : currentHost());
    document.title = forTitle ? `${forTitle} · ${t.title}` : t.title;
    if (logo) {
      document
        .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
        .forEach((el) => el.setAttribute("href", logo));
      const host = currentHost();
      const man = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (man && host) man.setAttribute("href", `/manifest.webmanifest?d=${encodeURIComponent(host)}`);
    }
  }, [branding, t.title]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await login(values.identifier, values.password);
      toast.success("Authenticated");
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  const logoUrl = branding?.logo_url
    ? branding.logo_url.startsWith("http")
      ? branding.logo_url
      : `${API_URL}${branding.logo_url}`
    : null;
  const brandName = (branding?.brand_name || "").trim();
  const platform = isPlatformHost(currentHost());
  // Name shown in the hero: brand → bare domain (tenant) → MarginPlant (only
  // on the platform host). Never "MarginPlant" on a connected tenant domain.
  const heroName = brandName || (platform ? "" : currentHost());

  return (
    // Force-light auth surface (independent of the panel's dark theme) — a
    // clean, professional, mobile-first single card. Admin = emerald, broker =
    // violet: only the gradient header differs.
    <main className="grid min-h-screen place-items-center bg-slate-100 p-4 text-slate-900">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-[0_12px_45px_rgba(2,6,23,0.14)]">
        {/* Gradient header — centred logo + brand + role. */}
        <div className={`relative overflow-hidden bg-gradient-to-br ${t.grad} px-6 pb-7 pt-9 text-center text-white`}>
          <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-white/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-14 -left-8 size-40 rounded-full bg-black/10 blur-2xl" />
          <div className="relative mx-auto grid size-16 place-items-center rounded-2xl bg-white shadow-lg">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={heroName || "logo"} className="max-h-12 max-w-12 object-contain" />
            ) : platform ? (
              <BrandLogo href={null} size="sm" showAdminBadge={false} />
            ) : (
              <Icon className="size-8 text-slate-700" />
            )}
          </div>
          {heroName && <div className="relative mt-3 text-lg font-bold">{heroName}</div>}
          <div className="relative mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
            <Icon className="size-3" /> {t.badgeText}
          </div>
          <h1 className="relative mt-3 text-2xl font-bold">{t.title}</h1>
        </div>

        {/* Form body — light. */}
        <div className="px-6 py-6">
          <p className="mb-4 text-center text-sm text-slate-500">{t.sub}</p>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-slate-700">Email or user code</Label>
              <Input
                id="identifier"
                autoComplete="username"
                className="border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier && (
                <p className="text-xs text-rose-500">{form.formState.errors.identifier.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-700">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-rose-500">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button
              type="submit"
              className={`w-full bg-gradient-to-r ${t.grad} text-white shadow-md hover:opacity-95`}
              loading={form.formState.isSubmitting}
            >
              Sign in
            </Button>
            <p className="text-center text-[11px] text-slate-400">
              Activity is logged · IP allow-listing &amp; rate-limiting enforced.
            </p>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-4 text-center">
            <div className="text-xs font-semibold text-slate-700">Install app</div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              One-tap home-screen launcher. Stays signed in like a native app.
            </p>
            <div className="mt-2 flex justify-center">
              <InstallPWAButton />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
