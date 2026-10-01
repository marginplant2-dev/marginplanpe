"use client";

import { useState } from "react";
import { API_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Real-logo instrument icon.
 *
 *  • Crypto → coin logo from the jsDelivr-hosted cryptocurrency-icons set
 *    (spothq), keyed by the base ticker (BTCUSD → btc).
 *  • Forex  → the two real country flags of the pair (flagcdn), overlapped.
 *  • Stock / index → the company logo from our own origin
 *    (GET /api/v1/logo/{symbol}, which proxies + caches Dhan / TradingView),
 *    layered over a colored letter avatar. If no logo exists the <img> errors
 *    and the letter avatar underneath shows through.
 *
 * Every remote image degrades to the letter avatar on load error, so a missing
 * coin/flag/logo never shows a broken-image glyph.
 */

const QUOTE_SUFFIXES = ["USDT", "USDC", "USD", "INR", "BUSD", "EUR", "GBP"];

// Currency → ISO-3166 country (flagcdn) code. EUR uses the EU flag.
const CCY_FLAG: Record<string, string> = {
  USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", AUD: "au", NZD: "nz",
  CAD: "ca", CHF: "ch", CNY: "cn", INR: "in", SGD: "sg", HKD: "hk",
  ZAR: "za", SEK: "se", NOK: "no", MXN: "mx", TRY: "tr", AED: "ae",
};

// Must mirror the backend guard (app/services/logo_service.py SYMBOL_RE): only
// these ever resolve to a logo, so skip the request for anything else (option
// strikes, odd tickers) instead of guaranteeing a 404 round-trip.
const LOGO_SYMBOL_RE = /^[A-Z0-9&_-]{1,24}$/;

// Failed logos, keyed BY SYMBOL (module-level, shared across every icon).
// A per-instance boolean would wrongly suppress the logo of whatever symbol
// lands next in a virtualised/re-sorted row that React recycled.
const failedLogos = new Set<string>();

function cryptoBase(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  for (const q of QUOTE_SUFFIXES) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

// Deterministic pleasant colour from the symbol so the same stock always gets
// the same avatar tint (used when no change direction is supplied).
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function InstrumentIcon({
  symbol,
  isCrypto,
  isForex,
  changePct,
  size = 28,
  className,
}: {
  symbol: string;
  isCrypto?: boolean;
  isForex?: boolean;
  /** When provided, the letter fallback is tinted green (up) / red (down). */
  changePct?: number | null;
  size?: number;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // "EXCHANGE:SYM" → "SYM"; rows pass a bare symbol but be defensive.
  const sym = (symbol || "").split(":").pop()!.toUpperCase();

  // Letter background: up/down tint when we know direction, else a stable hue.
  const bg =
    changePct == null || changePct === 0
      ? `hsl(${hashHue(sym)} 62% 45%)`
      : changePct > 0
        ? "#10b981"
        : "#ef4444";

  const letter = (extra?: string) => (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-white",
        extra,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42, background: bg }}
    >
      {sym.slice(0, 1) || "?"}
    </span>
  );

  if (isCrypto && !imgFailed) {
    const base = cryptoBase(sym).toLowerCase();
    return (
      <img
        src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@1.0.0/svg/color/${base}.svg`}
        alt={sym}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className={cn("shrink-0 rounded-full", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (isForex && sym.length >= 6) {
    const base = CCY_FLAG[sym.slice(0, 3)];
    const quote = CCY_FLAG[sym.slice(3, 6)];
    if (base || quote) {
      const flag = (cc: string, z: number, shift: number) => (
        <img
          src={`https://flagcdn.com/w40/${cc}.png`}
          alt={cc}
          className="absolute rounded-full border border-background object-cover"
          style={{ width: size * 0.68, height: size * 0.68, zIndex: z, left: shift }}
        />
      );
      return (
        <span
          className={cn("relative inline-block shrink-0", className)}
          style={{ width: size, height: size }}
        >
          {base && flag(base, 1, 0)}
          {quote && flag(quote, 2, size * 0.32)}
        </span>
      );
    }
  }

  // Stock / index — real company logo over the letter avatar.
  const wantLogo = LOGO_SYMBOL_RE.test(sym) && !failedLogos.has(sym);
  if (!wantLogo) return letter(className);

  return (
    <span
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {letter()}
      <img
        key={sym}
        src={`${API_URL}/api/v1/logo/${encodeURIComponent(sym)}`}
        alt={sym}
        loading="lazy"
        decoding="async"
        onError={() => {
          failedLogos.add(sym);
          setImgFailed((v) => !v); // force this instance to drop the <img>
        }}
        className="absolute inset-0 h-full w-full rounded-full bg-white object-contain"
      />
    </span>
  );
}
