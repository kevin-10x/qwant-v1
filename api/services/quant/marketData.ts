// marketData.ts — all-market OHLCV fetch for the quant engine.
// Crypto: Binance. Stocks/commodities: Yahoo Finance. Forex: Frankfurter (ECB, daily).
// Deterministic synthetic fallback so the engine always produces output offline.

import type { OHLCV } from "../market-data.js";

export type MarketKind = "crypto" | "stocks" | "commodities" | "forex";

export const MARKET_IDS = ["crypto", "stocks", "commodities", "forex"] as const;

const SYMBOLS: Record<MarketKind, string[]> = {
  crypto: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"],
  stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META"],
  commodities: ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F", "ZW=F"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "EURNOK", "USDSEK"],
};

const COMMODITY_NAMES: Record<string, string> = {
  "GC=F": "GOLD",
  "SI=F": "SILVER",
  "CL=F": "OIL",
  "NG=F": "NATGAS",
  "HG=F": "COPPER",
  "ZW=F": "WHEAT",
};

type Timeframe = "1d" | "4h" | "1h" | "1w";

export const TIMEFRAME_IDS = ["1d", "4h", "1h", "1w"] as const;

const INTERVALS: Record<string, { binance?: string; yahoo?: string }> = {
  "1d": { binance: "1d", yahoo: "1d" },
  "1h": { binance: "1h", yahoo: "60m" },
  "4h": { binance: "4h", yahoo: "60m" },
  "1w": { binance: "1w", yahoo: "1wk" },
};

export async function fetchQuantOHLCV(
  symbol: string,
  market: MarketKind,
  timeframe: Timeframe = "1d",
  limit = 500
): Promise<OHLCV[]> {
  switch (market) {
    case "crypto":
      return fetchBinance(symbol, timeframe, limit);
    case "stocks":
    case "commodities":
      return fetchYahoo(symbol, timeframe, limit);
    case "forex":
      return fetchForex(symbol, timeframe, limit);
    default:
      return syntheticSeries(symbol, limit);
  }
}

async function fetchBinance(symbol: string, timeframe: Timeframe, limit: number): Promise<OHLCV[]> {
  const interval = INTERVALS[timeframe]?.binance || "1d";
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${Math.min(limit, 1000)}`
    );
    if (!res.ok) throw new Error(`binance HTTP ${res.status}`);
    const rows = (await res.json()) as (string | number)[][];
    return rows.map((c) => ({
      timestamp: new Date(+c[0]),
      open: +c[1] as number,
      high: +c[2] as number,
      low: +c[3] as number,
      close: +c[4] as number,
      volume: +c[5] as number,
    }));
  } catch (e) {
    console.warn(`[quant] Binance fetch failed for ${symbol}: ${(e as Error).message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

async function fetchYahoo(symbol: string, timeframe: Timeframe, limit: number): Promise<OHLCV[]> {
  const interval = INTERVALS[timeframe]?.yahoo || "1d";
  const seconds = { "1d": 86400, "60m": 3600, "1wk": 604800 }[interval] || 86400;
  const rangeSeconds = seconds * Math.min(limit * 1.6, 730 * 86400);
  const period1 = Math.floor(Date.now() / 1000 - rangeSeconds);
  const period2 = Math.floor(Date.now() / 1000);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } });
    if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
    const json = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: Array<Record<string, (number | null)[]>> } }[] };
    };
    const result = json.chart?.result?.[0];
    if (!result) throw new Error("yahoo empty result");
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const out: OHLCV[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] == null || q.open?.[i] == null) continue;
      out.push({
        timestamp: new Date(ts[i] * 1000),
        open: q.open[i] as number,
        high: (q.high?.[i] as number) ?? (q.open[i] as number),
        low: (q.low?.[i] as number) ?? (q.close[i] as number),
        close: q.close[i] as number,
        volume: (q.volume?.[i] as number) ?? 0,
      });
    }
    if (!out.length) throw new Error("yahoo no valid bars");
    return out.slice(-limit);
  } catch (e) {
    console.warn(`[quant] Yahoo fetch failed for ${symbol}: ${(e as Error).message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

async function fetchForex(symbol: string, timeframe: Timeframe, limit: number): Promise<OHLCV[]> {
  if (timeframe !== "1d") {
    console.warn(`[quant] Forex ${symbol}: only 1d supported via ECB; synthetic for ${timeframe}`);
    return syntheticSeries(symbol, limit);
  }
  const base = symbol.slice(0, 3).toUpperCase();
  const quote = symbol.slice(3).toUpperCase();
  const days = Math.min(limit, 480);
  const from = new Date(Date.now() - days * 1.5 * 86400000).toISOString().slice(0, 10);
  try {
    const url = `https://api.frankfurter.app/${from}..?from=${base}&to=${quote}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    const rates = json.rates;
    if (!rates || !Object.keys(rates).length) throw new Error("frankfurter empty");
    const series: OHLCV[] = [];
    for (const [date, r] of Object.entries(rates).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const rate = r[quote];
      if (rate == null) continue;
      const prev = series[series.length - 1];
      if (prev) {
        series.push({
          timestamp: new Date(date),
          open: prev.close,
          high: Math.max(prev.close, rate),
          low: Math.min(prev.close, rate),
          close: rate,
          volume: 0,
        });
      } else {
        series.push({
          timestamp: new Date(date),
          open: rate,
          high: rate,
          low: rate,
          close: rate,
          volume: 0,
        });
      }
    }
    if (series.length < 60) throw new Error("frankfurter insufficient bars");
    return series.slice(-limit);
  } catch (e) {
    console.warn(`[quant] Forex fetch failed for ${symbol}: ${(e as Error).message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

function syntheticSeries(symbol: string, count: number): OHLCV[] {
  const seedBase = (symbol.length * 9301 + 49297) % 233280;
  let seed = seedBase;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const basePrice = symbol.startsWith("BTC")
    ? 78000
    : symbol.startsWith("ETH")
      ? 3500
      : 50 + rnd() * 400;
  const now = Date.now();
  const step = 86400000;
  const out: OHLCV[] = [];
  let price = basePrice;
  for (let i = count - 1; i >= 0; i--) {
    const drift = Math.sin((count - i) / 25) * 0.004;
    const change = (rnd() - 0.45) * 0.02 + drift;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + rnd() * 0.01);
    const low = Math.min(open, close) * (1 - rnd() * 0.01);
    out.push({
      timestamp: new Date(now - i * step),
      open,
      high,
      low,
      close,
      volume: rnd() * 1e7,
    });
    price = close;
  }
  return out;
}

export function getQuantSymbols(market: MarketKind): string[] {
  return SYMBOLS[market] || [];
}

export function quantDisplayName(symbol: string, market: MarketKind): string {
  if (market === "commodities") return COMMODITY_NAMES[symbol] || symbol;
  return symbol;
}