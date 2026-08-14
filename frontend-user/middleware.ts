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

export function middleware(req: NextRequest) {
  if (!HIDE) return NextResponse.next();

  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (!FLAGSHIP_HOSTS.has(host)) return NextResponse.next();

  const path = req.nextUrl.pathname;

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
