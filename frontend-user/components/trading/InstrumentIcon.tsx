"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Real-logo instrument icon.
 *
 *  • Crypto → coin logo from the jsDelivr-hosted cryptocurrency-icons set
 *    (spothq), keyed by the base ticker (BTCUSD → btc).
 *  • Forex  → the two real country flags of the pair (flagcdn), overlapped.
 *  • Everything else (Indian equity / index / commodity) → a clean colored
 *    letter avatar.  ponytail: real per-stock logos need a keyed logo API
 *    (logo.dev / Clearbit by domain); the letter avatar is the honest
 *    fallback until the backend exposes a `logo_url` per instrument.
 *
 * Every remote image degrades to the letter avatar on load error, so a
 * missing coin/flag never shows a broken-image glyph.
 */

const QUOTE_SUFFIXES = ["USDT", "USDC", "USD", "INR", "BUSD", "EUR", "GBP"];

// Currency → ISO-3166 country (flagcdn) code. EUR uses the EU flag.
const CCY_FLAG: Record<string, string> = {
  USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", AUD: "au", NZD: "nz",
  CAD: "ca", CHF: "ch", CNY: "cn", INR: "in", SGD: "sg", HKD: "hk",
  ZAR: "za", SEK: "se", NOK: "no", MXN: "mx", TRY: "tr", AED: "ae",
};

function cryptoBase(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  for (const q of QUOTE_SUFFIXES) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

// Deterministic pleasant colour from the symbol so the same stock always
// gets the same avatar tint.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function InstrumentIcon({
  symbol,
  isCrypto,
  isForex,
  size = 28,
  className,
}: {
  symbol: string;
  isCrypto?: boolean;
  isForex?: boolean;
  size?: number;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sym = (symbol || "").toUpperCase();

  const letter = (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `hsl(${hashHue(sym)} 62% 45%)`,
      }}
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

  return letter;
}
