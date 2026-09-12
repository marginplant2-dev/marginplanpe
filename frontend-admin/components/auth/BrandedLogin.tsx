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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    document.title = name ? `${name} · ${t.title}` : `${APP_NAME} · ${t.title}`;
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

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* ── Colourful brand hero — emerald (admin) vs indigo/violet (broker).
          The whole point of the two pages: instantly distinguishable. On
          mobile it collapses to a compact top band. ── */}
      <div className={`relative flex flex-col justify-between overflow-hidden bg-gradient-to-br ${t.grad} p-8 text-white lg:p-12`}>
        {/* soft decorative blobs */}
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 size-72 rounded-full bg-black/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName || "logo"} className="h-10 w-auto max-w-[200px] rounded-lg bg-white/95 object-contain p-1.5" />
          ) : (
            <span className="rounded-lg bg-white/95 p-1.5">
              <BrandLogo href={null} size="sm" showAdminBadge={false} />
            </span>
          )}
          {brandName && <span className="text-lg font-bold">{brandName}</span>}
        </div>
        <div className="relative hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur">
            <Icon className="size-3.5" />
            {t.badgeText}
          </div>
          <h1 className="mt-4 text-4xl font-bold leading-tight">{t.title}</h1>
          <p className="mt-3 max-w-sm text-sm text-white/85">{t.tagline}</p>
        </div>
        <div className="relative hidden text-xs text-white/70 lg:block">
          Activity is logged · IP allow-listing & rate-limiting enforced.
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="grid place-items-center p-6">
        <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className={`inline-flex w-fit items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider ${t.badge}`}>
            <Icon className="size-3" />
            {t.badgeText}
          </div>
          <CardTitle className="text-2xl">{t.title}</CardTitle>
          <CardDescription>
            {brandName ? `${brandName} — ` : ""}
            {t.sub}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or user code</Label>
              <Input id="identifier" autoComplete="username" className={t.ring} {...form.register("identifier")} />
              {form.formState.errors.identifier && (
                <p className="text-xs text-destructive">{form.formState.errors.identifier.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" className={t.ring} {...form.register("password")} />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className={`w-full bg-gradient-to-r ${t.grad} text-white hover:opacity-90`} loading={form.formState.isSubmitting}>
              Sign in
            </Button>
            <p className="text-xs text-muted-foreground">
              Activity is logged. IP allow-listing and rate-limiting are enforced server-side.
            </p>
          </form>

          <div className="mt-5 space-y-2 border-t border-border pt-4">
            <div className="text-xs font-semibold">Install app</div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              One-tap home-screen launcher. Stays signed in like a native app.
            </p>
            <InstallPWAButton />
          </div>
        </CardContent>
        </Card>
      </div>
    </main>
  );
}
