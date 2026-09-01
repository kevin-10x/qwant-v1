// marketData.mjs — fetch OHLCV across all markets.
// Crypto: Binance. Stocks/commodities: Yahoo Finance. Forex: Frankfurter (ECB, daily).
// All calls use global fetch (Node 18+). Each source falls back to a deterministic
// synthetic series only when the network truly fails, so the engine always produces output.

export const MARKETS = ["crypto", "stocks", "commodities", "forex"];

const SYMBOLS = {
  crypto: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"],
  stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META"],
  commodities: ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F", "ZW=F"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "EURNOK", "USDSEK"],
};

const COMMODITY_NAMES = {
  "GC=F": "GOLD", "SI=F": "SILVER", "CL=F": "OIL", "NG=F": "NATGAS",
  "HG=F": "COPPER", "ZW=F": "WHEAT",
};

const INTERVAL_MAP = {
  "1d": { binance: "1d", yahoo: "1d" },
  "1h": { binance: "1h", yahoo: "60m" },
  "4h": { binance: "4h", yahoo: "60m" },
  "1w": { binance: "1w", yahoo: "1wk" },
};

export async function fetchOHLCV(symbol, market, timeframe = "1d", limit = 500) {
  switch (market) {
    case "crypto":
      return fetchBinance(symbol, timeframe, limit);
    case "stocks":
      return fetchYahoo(symbol, timeframe, limit);
    case "commodities":
      return fetchYahoo(symbol, timeframe, limit);
    case "forex":
      return fetchForex(symbol, timeframe, limit);
    default:
      return syntheticSeries(symbol, limit);
  }
}

async function fetchBinance(symbol, timeframe, limit) {
  const interval = INTERVAL_MAP[timeframe]?.binance || "1d";
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${Math.min(limit, 1000)}`
    );
    if (!res.ok) throw new Error(`binance HTTP ${res.status}`);
    const rows = await res.json();
    return rows.map((c) => ({
      timestamp: new Date(c[0]),
      open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
    }));
  } catch (e) {
    console.warn(`  ! Binance fetch failed for ${symbol}: ${e.message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

async function fetchYahoo(symbol, timeframe, limit) {
  const interval = INTERVAL_MAP[timeframe]?.yahoo || "1d";
  const seconds = { "1d": 86400, "60m": 3600, "1wk": 604800 }[interval] || 86400;
  // Request roughly 2x needed bars to allow for holidays/holes, capped ~2y.
  const rangeSeconds = seconds * Math.min(limit * 1.6, 730 * 86400);
  const period1 = Math.floor(Date.now() / 1000 - rangeSeconds);
  const period2 = Math.floor(Date.now() / 1000);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } });
    if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("yahoo empty result");
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] == null || q.open?.[i] == null) continue;
      out.push({
        timestamp: new Date(ts[i] * 1000),
        open: q.open[i], high: q.high[i] ?? q.open[i],
        low: q.low[i] ?? q.close[i], close: q.close[i], volume: q.volume[i] ?? 0,
      });
    }
    if (!out.length) throw new Error("yahoo no valid bars");
    return out.slice(-limit);
  } catch (e) {
    console.warn(`  ! Yahoo fetch failed for ${symbol}: ${e.message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

// Frankfurter (European Central Bank) — free daily FX reference rates, no key.
async function fetchForex(symbol, timeframe, limit) {
  if (timeframe !== "1d") {
    console.warn(`  ! Forex ${symbol}: only 1d supported via ECB; using synthetic for ${timeframe}`);
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
    const json = await res.json();
    const rates = json?.rates;
    if (!rates || !Object.keys(rates).length) throw new Error("frankfurter empty");
    const series = [];
    for (const [date, r] of Object.entries(rates).sort()) {
      const rate = r[quote];
      if (rate == null) continue;
      const prev = series[series.length - 1];
      const close = +rate;
      if (prev) {
        series.push({
          timestamp: new Date(date),
          open: prev.close,
          high: Math.max(prev.close, close),
          low: Math.min(prev.close, close),
          close,
          volume: 0,
        });
      } else {
        series.push({ timestamp: new Date(date), open: close, high: close, low: close, close, volume: 0 });
      }
    }
    if (series.length < 60) throw new Error("frankfurter insufficient bars");
    return series.slice(-limit);
  } catch (e) {
    console.warn(`  ! Forex fetch failed for ${symbol}: ${e.message}; using synthetic`);
    return syntheticSeries(symbol, limit);
  }
}

// Deterministic-ish synthetic series so the engine never crashes offline.
function syntheticSeries(symbol, count) {
  const seedBase = (symbol.length * 9301 + 49297) % 233280;
  let seed = seedBase;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const basePrice = symbol.startsWith("BTC") ? 78000 : symbol.startsWith("ETH") ? 3500 : 50 + rnd() * 400;
  const now = Date.now();
  const step = 86400000;
  const out = [];
  let price = basePrice;
  // Seed a trend so the series is interesting (up then mean-revert).
  for (let i = count - 1; i >= 0; i--) {
    const drift = Math.sin((count - i) / 25) * 0.004;
    const change = (rnd() - 0.45) * 0.02 + drift;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + rnd() * 0.01);
    const low = Math.min(open, close) * (1 - rnd() * 0.01);
    out.push({ timestamp: new Date(now - i * step), open, high, low, close, volume: rnd() * 1e7 });
    price = close;
  }
  return out;
}

export function getSymbols(market) {
  return SYMBOLS[market] || [];
}

export function displayName(symbol, market) {
  if (market === "commodities") return COMMODITY_NAMES[symbol] || symbol;
  return symbol;
}
