"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

/**
 * TradingView "market overview" widget (free embed, no key) — tabs for
 * Indices / Forex / Crypto / Commodities with sparklines. Desktop dashboard
 * only. Re-mounts on theme change so light/dark stay in sync.
 */
export function MarketOverviewTV() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
  const colorTheme = resolvedTheme === "light" ? "light" : "dark";

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML =
      '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      colorTheme,
      dateRange: "12M",
      showChart: true,
      locale: "en",
      isTransparent: true,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      width: "100%",
      height: "100%",
      tabs: [
        {
          title: "Indices",
          symbols: [
            { s: "BSE:SENSEX", d: "SENSEX" },
            { s: "NSE:NIFTY", d: "NIFTY 50" },
            { s: "NSE:BANKNIFTY", d: "BANK NIFTY" },
            { s: "FOREXCOM:SPXUSD", d: "S&P 500" },
            { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100" },
          ],
        },
        {
          title: "Forex",
          symbols: [
            { s: "FX:EURUSD", d: "EUR/USD" },
            { s: "FX:GBPUSD", d: "GBP/USD" },
            { s: "FX:USDJPY", d: "USD/JPY" },
            { s: "FX_IDC:USDINR", d: "USD/INR" },
          ],
        },
        {
          title: "Crypto",
          symbols: [
            { s: "BINANCE:BTCUSDT", d: "Bitcoin" },
            { s: "BINANCE:ETHUSDT", d: "Ethereum" },
            { s: "BINANCE:SOLUSDT", d: "Solana" },
            { s: "BINANCE:BNBUSDT", d: "BNB" },
          ],
        },
        {
          title: "Commodities",
          symbols: [
            { s: "TVC:GOLD", d: "Gold" },
            { s: "TVC:SILVER", d: "Silver" },
            { s: "TVC:USOIL", d: "Crude Oil" },
            { s: "MCX:CRUDEOIL1!", d: "MCX Crude" },
          ],
        },
      ],
    });
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
    };
  }, [colorTheme]);

  return <div ref={ref} className="tradingview-widget-container h-full w-full" />;
}
