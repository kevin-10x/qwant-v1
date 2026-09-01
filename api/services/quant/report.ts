// report.ts — daily quant report: latest signal + market structure + fib levels.

import type { OHLCV } from "../market-data.js";
import { rsi, atr, ema, lastNonNull } from "./indicators.js";
import { buildFibSnapshot, type FibSnapshot } from "./fibonacci.js";
import type { MarketKind } from "./marketData.js";

interface SignalResult {
  dir: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasons: string[];
  entry: number | null;
  sl: number | null;
  tp: number | null;
  ext1272: { level: number; price: number } | null;
  ext1618: { level: number; price: number } | null;
}

function signalFromSnapshot(
  snapshot: FibSnapshot,
  bar: OHLCV,
  rsiNow: number | null,
  atrPct: number
): SignalResult {
  const { structure, levels, nearestRetracement, lastHigh, lastLow } = snapshot;
  const price = bar.close;

  let dir: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  const reasons: string[] = [];
  let entry: number | null = null;
  let sl: number | null = null;
  let tp: number | null = null;

  let bull = 0;
  let bear = 0;
  if (structure === "bullish") {
    bull += 30;
    reasons.push("bullish market structure (HH/HL)");
  }
  if (structure === "bearish") {
    bear += 30;
    reasons.push("bearish market structure (LH/LL)");
  }
  if (rsiNow != null && rsiNow < 40 && levels?.force === "up") {
    bull += 20;
    reasons.push("oversold-ish pullback in up leg");
  }
  if (rsiNow != null && rsiNow > 60 && levels?.force === "down") {
    bear += 20;
    reasons.push("overbought-ish pullback in down leg");
  }
  if (rsiNow != null && rsiNow > 70) {
    bear += 10;
    reasons.push("deep overbought");
  }

  if (nearestRetracement && levels) {
    const zoneDist = nearestRetracement.dist / (atrPct * price || 1);
    if (zoneDist < 0.5 && levels.force === "up") {
      bull += 25;
      reasons.push(`near fib retrace ${nearestRetracement.level}`);
      entry = nearestRetracement.price;
    }
    if (zoneDist < 0.5 && levels.force === "down") {
      bear += 25;
      reasons.push(`near fib retrace ${nearestRetracement.level}`);
      entry = nearestRetracement.price;
    }
  }

  const ext1272 = levels?.extensions?.find((e) => e.level === 1.272) ?? null;
  const ext1618 = levels?.extensions?.find((e) => e.level === 1.618) ?? null;

  if (bull >= 60 && bull > bear) {
    dir = "BUY";
    confidence = Math.min(95, bull);
    entry = entry ?? price;
    sl = lastLow ? Math.min(lastLow.price, price * 0.99) : price * 0.98;
    tp = ext1272 ? ext1272.price : price * 1.03;
  } else if (bear >= 60 && bear > bull) {
    dir = "SELL";
    confidence = Math.min(95, bear);
    entry = entry ?? price;
    sl = lastHigh ? Math.max(lastHigh.price, price * 1.01) : price * 1.02;
    tp = ext1272 ? ext1272.price : price * 0.97;
  }

  return { dir, confidence, reasons, entry, sl, tp, ext1272, ext1618 };
}

export interface QuantReport {
  symbol: string;
  market: MarketKind;
  timeframe: string;
  generatedAt: string;
  error?: string;
  bars?: number;
  price?: number;
  change1dPct?: number | null;
  indicators?: { rsi: number; atrPct: number; ema20: number | null; ema50: number | null };
  structure?: {
    trend: string;
    lastHigh: string | null;
    lastLow: string | null;
    lastSwing: { force: "up" | "down"; start: number; end: number } | null;
  };
  fibonacci?: {
    force: "up" | "down" | null;
    retracements: { level: number; price: number }[];
    extensions: { level: number; price: number }[];
    nearest: { level: number; price: number; distPct: number } | null;
  };
  signal?: {
    dir: "BUY" | "SELL" | "HOLD";
    confidence: number;
    reasons: string[];
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    ext1272: number | null;
    ext1618: number | null;
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function generateQuantReport(
  bars: OHLCV[],
  args: { symbol: string; market: MarketKind; timeframe: string }
): QuantReport {
  const { symbol, market, timeframe } = args;
  if (bars.length < 80) {
    return {
      symbol,
      market,
      timeframe,
      generatedAt: new Date().toISOString(),
      error: "insufficient data",
      bars: bars.length,
    };
  }
  const snapshot = buildFibSnapshot(bars);
  const bar = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const rsiNow = lastNonNull(rsi(closes, 14)) ?? 50;
  const a = lastNonNull(atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14)) ?? bar.close * 0.02;
  const ema20 = lastNonNull(ema(closes, 20));
  const ema50 = lastNonNull(ema(closes, 50));

  const sig = signalFromSnapshot(snapshot, bar, rsiNow, a / bar.close);
  const lastSwing = snapshot.lastLeg
    ? { force: snapshot.lastLeg.force as "up" | "down", start: snapshot.lastLeg.startPrice, end: snapshot.lastLeg.endPrice }
    : null;

  return {
    symbol,
    market,
    timeframe,
    generatedAt: bar.timestamp.toISOString(),
    price: bar.close,
    change1dPct:
      closes.length > 2
        ? round2(((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100)
        : null,
    indicators: {
      rsi: round1(rsiNow),
      atrPct: round2((a / bar.close) * 100),
      ema20: ema20 != null ? round2(ema20) : null,
      ema50: ema50 != null ? round2(ema50) : null,
    },
    structure: {
      trend: snapshot.structure,
      lastHigh: snapshot.lastHigh ? Number(snapshot.lastHigh.price).toFixed(2) : null,
      lastLow: snapshot.lastLow ? Number(snapshot.lastLow.price).toFixed(2) : null,
      lastSwing,
    },
    fibonacci: {
      force: snapshot.levels?.force ?? null,
      retracements: snapshot.levels
        ? snapshot.levels.retracements.map((r) => ({ level: r.level, price: round2(r.price) }))
        : [],
      extensions: snapshot.levels
        ? snapshot.levels.extensions.map((e) => ({ level: e.level, price: round2(e.price) }))
        : [],
      nearest: snapshot.nearestRetracement
        ? {
            level: snapshot.nearestRetracement.level,
            price: round2(snapshot.nearestRetracement.price),
            distPct: round2((snapshot.nearestRetracement.dist / bar.close) * 100),
          }
        : null,
    },
    signal: {
      dir: sig.dir,
      confidence: sig.confidence,
      reasons: sig.reasons,
      entry: sig.entry != null ? round2(sig.entry) : null,
      stopLoss: sig.sl != null ? round2(sig.sl) : null,
      takeProfit: sig.tp != null ? round2(sig.tp) : null,
      ext1272: sig.ext1272 ? round2(sig.ext1272.price) : null,
      ext1618: sig.ext1618 ? round2(sig.ext1618.price) : null,
    },
  };
}