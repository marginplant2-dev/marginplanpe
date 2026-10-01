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

// A blocked visitor must NOT realise they're blocked — show a page that looks
// exactly like the browser's own "This site can't be reached" (DNS NXDOMAIN)
// error, so it feels like the site is simply down / the address is wrong.
function blockedResponse(host: string): NextResponse {
  const safeHost = (host || "this site").replace(/[^a-z0-9.\-:]/gi, "") || "this site";
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>' +
    safeHost +
    "</title><style>" +
    ":root{color-scheme:dark}*{box-sizing:border-box}" +
    "html,body{height:100%;margin:0}" +
    "body{background:#202124;color:#9aa0a6;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}" +
    ".wrap{min-height:100%;display:flex;flex-direction:column;max-width:560px;margin:0 auto;padding:44px 24px 28px}" +
    ".icon{width:72px;height:72px;margin:24px 0 26px}" +
    "h1{color:#e8eaed;font-weight:400;font-size:26px;line-height:1.3;margin:0 0 20px}" +
    "p{font-size:15px;line-height:1.6;margin:0 0 15px}" +
    ".code{font-size:13px;margin-top:4px}" +
    "a{color:#8ab4f8;text-decoration:none}" +
    ".spacer{flex:1}" +
    "button{align-self:stretch;background:#8ab4f8;color:#202124;border:0;border-radius:24px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;margin-top:26px}" +
    "@media(min-width:600px){button{align-self:flex-end;min-width:104px;padding:9px 22px;border-radius:4px;font-weight:500}}" +
    "</style></head><body><div class=\"wrap\">" +
    '<svg class="icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M11 5h18l9 9v29H11z" fill="none" stroke="#5f6368" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M29 5v9h9" fill="none" stroke="#5f6368" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="20" cy="25" r="1.7" fill="#5f6368"/><circle cx="29" cy="25" r="1.7" fill="#5f6368"/>' +
    '<path d="M19 34 Q24.5 29 30 34" fill="none" stroke="#5f6368" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>" +
    "<h1>This site can&rsquo;t be reached</h1>" +
    "<p>Check if there is a typo in " +
    safeHost +
    ".</p>" +
    '<p>If spelling is correct, <a href="#" onclick="return false">try running Windows Network Diagnostics</a>.</p>' +
    '<p class="code">DNS_PROBE_FINISHED_NXDOMAIN</p>' +
    '<div class="spacer"></div>' +
    '<button onclick="location.reload()">Reload</button>' +
    "</div></body></html>";
  return new NextResponse(html, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
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

  // Hard IP gate first — a banned IP sees a fake "site can't be reached" page
  // for ANY page, before the login redirect or anything else, so it feels like
  // the site is down rather than that they were blocked.
  if (await isIpBlocked(req)) {
    return blockedResponse(host);
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
