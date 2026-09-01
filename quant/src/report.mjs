// report.mjs — daily quant report: latest signal + market structure + fib levels.

import { rsi, atr, ema, lastNonNull } from "./indicators.mjs";
import { buildFibSnapshot } from "./fibonacci.mjs";

// Compute confluence score for a candidate direction using the latest snapshot.
function signalFromSnapshot(snapshot, bar, rsiNow, atrPct) {
  const { structure, levels, nearestRetracement, lastHigh, lastLow } = snapshot;
  const price = bar.close;

  let dir = "HOLD";
  let confidence = 0;
  const reasons = [];
  let entry = null, sl = null, tp = null;

  // Bullish confluence
  let bull = 0, bear = 0;
  if (structure === "bullish") { bull += 30; reasons.push("bullish market structure (HH/HL)"); }
  if (structure === "bearish") { bear += 30; reasons.push("bearish market structure (LH/LL)"); }
  if (rsiNow != null && rsiNow < 40 && levels?.force === "up") { bull += 20; reasons.push("oversold-ish pullback in up leg"); }
  if (rsiNow != null && rsiNow > 60 && levels?.force === "down") { bear += 20; reasons.push("overbought-ish pullback in down leg"); }
  if (rsiNow != null && rsiNow < 30) { bull -= 0; reasons.push("deep oversold"); }
  if (rsiNow != null && rsiNow > 70) { bear += 10; reasons.push("deep overbought"); }

  // Fib retracement zone proximity (within 10% of ATR of a level).
  if (nearestRetracement && levels) {
    const zoneDist = nearestRetracement.dist / (atrPct * price || 1);
    if (zoneDist < 0.5 && levels.force === "up") { bull += 25; reasons.push(`near fib retrace ${nearestRetracement.level}`); entry = nearestRetracement.price; }
    if (zoneDist < 0.5 && levels.force === "down") { bear += 25; reasons.push(`near fib retrace ${nearestRetracement.level}`); entry = nearestRetracement.price; }
  }

  // Extension target 1.272 for profit objective.
  const ext1272 = levels?.extensions?.find((e) => e.level === 1.272);
  const ext1618 = levels?.extensions?.find((e) => e.level === 1.618);

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

export function printReport(r) {
  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }
  console.log(`  price       : ${r.price}`);
  console.log(`  change1d    : ${r.change1dPct != null ? r.change1dPct.toFixed(2) : "n/a"}%`);
  console.log(`  trend       : ${r.structure.trend}`);
  console.log(`  lastHigh    : ${r.structure.lastHigh}   lastLow: ${r.structure.lastLow}`);
  console.log(`  RSI         : ${r.indicators.rsi}   ATR%: ${r.indicators.atrPct}`);
  if (r.fibonacci.force) {
    console.log(`  fib leg     : ${r.fibonacci.force.toUpperCase()}`);
    console.log(`  fib levels  : ${r.fibonacci.retracements.map((x) => `${x.level}=${x.price}`).join("  ")}`);
    if (r.fibonacci.nearest) {
      console.log(`  nearest fib : ${r.fibonacci.nearest.level} @ ${r.fibonacci.nearest.price} (${r.fibonacci.nearest.distPct}%)`);
    }
    console.log(`  extensions  : ${r.fibonacci.extensions.map((x) => `${x.level}=${x.price}`).join("  ")}`);
  }
  const s = r.signal;
  console.log(`  SIGNAL      : ${s.dir}  (conf ${s.confidence}%)`);
  if (s.dir !== "HOLD") {
    console.log(`    entry ${s.entry}  sl ${s.stopLoss}  tp ${s.takeProfit}  (ext1.272 ${s.ext1272})`);
    console.log(`    reasons: ${s.reasons.join("; ")}`);
  }
}

export function generateReport(bars, { symbol, market, timeframe }) {
  if (bars.length < 80) {
    return { symbol, market, timeframe, error: "insufficient data", bars: bars.length };
  }
  const snapshot = buildFibSnapshot(bars);
  const bar = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const rsiArr = rsi(closes, 14);
  const rsiNow = lastNonNull(rsiArr) ?? 50;
  const atrArr = atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14);
  const a = lastNonNull(atrArr) ?? bar.close * 0.02;
  const ema20 = lastNonNull(ema(closes, 20));
  const ema50 = lastNonNull(ema(closes, 50));

  const sig = signalFromSnapshot(snapshot, bar, rsiNow, a / bar.close);
  const lastSwing = snapshot.lastLeg
    ? { force: snapshot.lastLeg.force, start: snapshot.lastLeg.startPrice, end: snapshot.lastLeg.endPrice }
    : null;

  return {
    symbol,
    market,
    timeframe,
    generatedAt: bar.timestamp.toISOString(),
    price: bar.close,
    change1dPct: closes.length > 2 ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : null,
    indicators: {
      rsi: +rsiNow?.toFixed(1),
      atrPct: +((a / bar.close) * 100).toFixed(2),
      ema20: ema20 != null ? +ema20?.toFixed(2) : null,
      ema50: ema50 != null ? +ema50?.toFixed(2) : null,
    },
    structure: {
      trend: snapshot.structure,
      lastHigh: snapshot.lastHigh?.price?.toFixed(2) ?? null,
      lastLow: snapshot.lastLow?.price?.toFixed(2) ?? null,
      lastSwing,
    },
    fibonacci: {
      force: snapshot.levels?.force ?? null,
      retracements: snapshot.levels ? snapshot.levels.retracements.map((r) => ({ level: r.level, price: +r.price.toFixed(2) })) : [],
      extensions: snapshot.levels ? snapshot.levels.extensions.map((e) => ({ level: e.level, price: +e.price.toFixed(2) })) : [],
      nearest: snapshot.nearestRetracement
        ? { level: snapshot.nearestRetracement.level, price: +snapshot.nearestRetracement.price.toFixed(2), distPct: +((snapshot.nearestRetracement.dist / bar.close) * 100).toFixed(2) }
        : null,
    },
    signal: {
      dir: sig.dir,
      confidence: sig.confidence,
      reasons: sig.reasons,
      entry: sig.entry != null ? +sig.entry?.toFixed(2) : null,
      stopLoss: sig.sl != null ? +sig.sl?.toFixed(2) : null,
      takeProfit: sig.tp != null ? +sig.tp?.toFixed(2) : null,
      ext1272: sig.ext1272?.price ? +sig.ext1272.price.toFixed(2) : null,
      ext1618: sig.ext1618?.price ? +sig.ext1618.price.toFixed(2) : null,
    },
  };
}
