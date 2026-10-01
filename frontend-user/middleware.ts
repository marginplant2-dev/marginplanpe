import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────
//  Flagship-domain hiding.
//
//  When HIDE_PUBLIC_SITE=true, the public marketing site is made to look
//  "not found" ONLY on the flagship host (marginplant.com / www) so the
//  platform isn't publicly discoverable via search.  Everything that
//  matters keeps working, untouched:
//    • /login, /register (+ ?ref=), /2fa, /forgot-password
//    • the whole trading app (/dashboard, /terminal, /wallet, …)
//    • api.marginplant.com + admin.marginplant.com (separate hosts)
//    • every branded tenant domain (their host isn't the flagship, so
//      this middleware passes through and their marketing still shows)
//
//  Toggle: set HIDE_PUBLIC_SITE=false and rebuild to restore the public
//  site.  (Middleware env is read at build time, so a rebuild is needed.)
// ─────────────────────────────────────────────────────────────────────
const HIDE = process.env.HIDE_PUBLIC_SITE === "true";

const FLAGSHIP_HOSTS = new Set(["marginplant.com", "www.marginplant.com"]);

// Platform hosts (flagship + dev/preview). Anything NOT in here is a branded
// tenant domain (trade5x.in, marginx.in, …) — those are login portals, so their
// bare domain opens /login instead of the marketing site.
const PLATFORM_HOSTS = new Set([
  "marginplant.com",
  "www.marginplant.com",
  "localhost",
  "127.0.0.1",
]);

function isBrandedHost(host: string): boolean {
  if (!host || PLATFORM_HOSTS.has(host)) return false;
  // Preview/deploy hosts are platform, not tenant domains.
  return !/\.(vercel\.app|netlify\.app|fly\.dev)$/.test(host);
}

// The `(marketing)` route group — the ONLY paths that get hidden. Login,
// register, and every authenticated app route are deliberately absent.
const MARKETING_PREFIXES = [
  "/about",
  "/blog",
  "/commodities",
  "/contact",
  "/copy-trading",
  "/demo",
  "/education",
  "/equity",
  "/faq",
  "/features",
  "/futures-options",
  "/how-it-works",
  "/ib-management",
  "/indices",
  "/instruments",
  "/learn",
  "/legal",
  "/markets",
  "/pricing",
  "/privacy",
  "/pro",
  "/security",
  "/standard",
  "/web-terminal",
];

function isMarketingPath(path: string): boolean {
  if (path === "/") return true;
  return MARKETING_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// ── IP block gate ────────────────────────────────────────────────────
// A banned IP (super-admin GLOBAL blocklist) must not even open the site —
// login / register / landing included. We ask the backend (which resolves the
// real client IP from the forwarded CF-Connecting-IP) on each full page load;
// it answers from a ~20s in-memory cache so this is ~1ms. Fail OPEN if the
// backend is unreachable so a backend hiccup never locks everyone out.
//
// IMPORTANT: call the backend INTERNALLY (127.0.0.1), NOT via the public URL —
// if this server-to-server call went back through Cloudflare, CF would rewrite
// CF-Connecting-IP to THIS server's IP and the backend would never see (or
// block) the real visitor. Internally, the cf-connecting-ip header we forward
// from the visitor's request is the one the backend reads.
const IP_GATE_API = process.env.IP_GATE_API_URL || "http://127.0.0.1:8000";

function blockedResponse(): NextResponse {
  return new NextResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Access blocked</title></head>' +
      '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
      '<div style="text-align:center;padding:24px;max-width:420px">' +
      '<div style="font-size:48px;line-height:1;margin-bottom:16px">&#128683;</div>' +
      '<h1 style="font-size:20px;margin:0 0 8px">Access blocked</h1>' +
      '<p style="font-size:14px;color:#9ca3af;margin:0">Your network has been blocked from accessing this site. If you believe this is a mistake, please contact support.</p>' +
      "</div></body></html>",
    {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

async function isIpBlocked(req: NextRequest): Promise<boolean> {
  if (!IP_GATE_API) return false;
  const headers: Record<string, string> = {};
  for (const h of ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const res = await fetch(`${IP_GATE_API}/api/v1/ip-gate`, { headers, cache: "no-store" });
    if (res.status === 403) return true; // global gate already rejected us
    if (res.ok) {
      const j = await res.json().catch(() => null);
      return Boolean(j?.data?.blocked);
    }
  } catch {
    // backend unreachable → fail open (don't lock everyone out)
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const path = req.nextUrl.pathname;

  // Hard IP gate first — a banned IP sees the block page for ANY page, before
  // the login redirect or anything else.
  if (await isIpBlocked(req)) {
    return blockedResponse();
  }

  // Branded tenant domains are login portals — the bare domain opens /login,
  // not the MarginPlant marketing site. Login / register / the app are untouched.
  if (isBrandedHost(host) && path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (!HIDE) return NextResponse.next();
  if (!FLAGSHIP_HOSTS.has(host)) return NextResponse.next();

  // De-index the flagship domain wholesale so search engines drop it.
  if (path === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Hide the public marketing pages; leave login / register / the app alone.
  if (isMarketingPath(path)) {
    return new NextResponse(
      '<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Not available</title></head><body style="margin:0;background:#0a0a0a"></body></html>',
      {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex, nofollow",
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals + API routes. The handler
  // itself narrows to the flagship host + marketing paths.
  matcher: ["/((?!_next/|api/).*)"],
};
