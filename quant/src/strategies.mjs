// strategies.mjs — market-structure + Fibonacci strategies.
// Each strategy is a pure function evaluated at bar index `i` using ONLY bars up
// to and including index `i` (no lookahead). Returns an entry decision or null.
//
// SL/TP are returned as prices; the backtester executes them with prioritization.

import { ema, rsi, atr, lastNonNull } from "./indicators.mjs";
import { swingPoints, trendOf } from "./marketStructure.mjs";
import { RETRACEMENTS, EXTENSIONS, upLegLevels, downLegLevels } from "./fibonacci.mjs";

// ---------------------------------------------------------------------------
// FIB RETRACEMENT  — pullback entry into the prevailing swing trend.
// Buy when price retraces into 0.382/0.5/0.618 of an UP leg and RSI confirms
// the pullback is not a breakdown. Mirror for shorts.
// ---------------------------------------------------------------------------
export function fibRetraceStrategy(bars, i, cfg = {}) {
  const lookback = 120;
  const start = Math.max(0, i - lookback);
  const slice = bars.slice(start, i + 1);
  if (slice.length < 60) return null;

  const closes = slice.map((b) => b.close);
  const rsiArr = rsi(closes, 14);
  const rsiNow = rsiArr[rsiArr.length - 1];
  if (rsiNow == null) return null;
  const ema50 = lastNonNull(ema(closes, 50));
  if (ema50 == null) return null;

  const { highs, lows } = swingPoints(slice, 3, 3);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  if (!lastHigh || !lastLow || lastLow.index > lastHigh.index) return null;

  const atrArr = atr(slice.map((b) => b.high), slice.map((b) => b.low), closes, 14);
  const a = lastNonNull(atrArr) || bars[i].close * 0.02;
  const candle = bars[i];
  const prev = slice[slice.length - 2] || candle;

  // LONG setup: prevailing uptrend, pullback test of a fib level, reversal close.
  if (candle.close > ema50) {
    const leg = upLegLevels({ price: lastLow.price }, { price: lastHigh.price });
    for (const rt of leg.retracements) {
      if (rt.level < 0.236) continue;
      // Pullback touched the zone (recent low near/pierced the level) and the
      // current bar closed back above it. RSI must not be mid-range overbought.
      const prevLow = Math.min(prev.low, candle.low);
      const touched = prevLow <= rt.price + 0.25 * a;
      if (!touched) continue;
      const closedUp = candle.close >= rt.price - 0.5 * a && candle.close > prev.close;
      if (closedUp && rsiNow >= 30 && rsiNow <= 65) {
        return {
          type: "LONG",
          sl: Math.min(lastLow.price, rt.price - 1.25 * a),
          tp: lastHigh.price + (cfg.extensionFactor ?? 0) * (leg.size),
          reason: `fib_retr_long@${rt.level}`,
        };
      }
    }
  }

  // SHORT setup mirror.
  if (candle.close < ema50) {
    const leg = downLegLevels({ price: lastHigh.price }, { price: lastLow.price });
    for (const rt of leg.retracements) {
      if (rt.level < 0.236) continue;
      const prevHigh = Math.max(prev.high, candle.high);
      const touched = prevHigh >= rt.price - 0.25 * a;
      if (!touched) continue;
      const closedDown = candle.close <= rt.price + 0.5 * a && candle.close < prev.close;
      if (closedDown && rsiNow <= 70 && rsiNow >= 35) {
        return {
          type: "SHORT",
          sl: Math.max(lastHigh.price, rt.price + 1.25 * a),
          tp: lastLow.price - (cfg.extensionFactor ?? 0) * (leg.size),
          reason: `fib_retr_short@${rt.level}`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// FIB EXTENSION — trade momentum through a swing high, targetting +/-1.272/+1.618
// extensions of the prior leg.
// ---------------------------------------------------------------------------
export function fibExtensionStrategy(bars, i, cfg = {}) {
  const lookback = 120;
  const start = Math.max(0, i - lookback);
  const slice = bars.slice(start, i + 1);
  if (slice.length < 60) return null;

  const closes = slice.map((b) => b.close);
  const rsiArr = rsi(closes, 14);
  const rsiNow = rsiArr[rsiArr.length - 1];
  if (rsiNow == null) return null;
  const atrArr = atr(slice.map((b) => b.high), slice.map((b) => b.low), closes, 14);
  const a = lastNonNull(atrArr) || bars[i].close * 0.02;

  const { highs, lows } = swingPoints(slice, 3, 3);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const candle = bars[i];

  // LONG: breakout above last swing high, in a favourable structure.
  if (lastHigh && candle.close > lastHigh.price && rsiNow > 55) {
    const leg = upLegLevels({ price: lastLow.price }, { price: lastHigh.price });
    const ext = EXTENSIONS.find((e) => e === cfg.extensionTarget);
    const targetLevel = ext ?? 1.618;
    return {
      type: "LONG",
      sl: candle.close - 2 * a,
      tp: lastHigh.price + (leg.swing1.price - leg.swing0.price) * (targetLevel - 1),
      reason: `fib_ext_long@${targetLevel}`,
    };
  }

  // SHORT: breakdown below last swing low.
  if (lastLow && candle.close < lastLow.price && rsiNow < 45) {
    const leg = downLegLevels({ price: lastHigh.price }, { price: lastLow.price });
    const targetLevel = EXTENSIONS.find((e) => e === cfg.extensionTarget) ?? 1.618;
    return {
      type: "SHORT",
      sl: candle.close + 2 * a,
      tp: lastLow.price - (leg.swing0.price - leg.swing1.price) * (targetLevel - 1),
      reason: `fib_ext_short@${targetLevel}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// BREAKOUT — range-breakout of the last N-bar high/low with ATR stop/target.
// ---------------------------------------------------------------------------
export function breakoutStrategy(bars, i, cfg = {}) {
  const n = cfg.range ?? 20;
  const start = Math.max(0, i - n);
  const window = bars.slice(start, i);
  if (window.length < n) return null;
  const candle = bars[i];
  const hi = Math.max(...window.map((b) => b.high));
  const lo = Math.min(...window.map((b) => b.low));
  const atrArr = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  const a = lastNonNull(atrArr) || candle.close * 0.02;
  const rr = cfg.rewardRisk ?? 2;

  if (candle.close > hi) {
    return { type: "LONG", sl: candle.close - 1.5 * a, tp: candle.close + rr * 1.5 * a, reason: "breakout_long" };
  }
  if (candle.close < lo) {
    return { type: "SHORT", sl: candle.close + 1.5 * a, tp: candle.close - rr * 1.5 * a, reason: "breakout_short" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// TREND FOLLOW (baseline) — EMA20/EMA50 crossover.
// ---------------------------------------------------------------------------
export function trendFollowStrategy(bars, i, cfg = {}) {
  if (i < 50) return null;
  const closes = bars.slice(0, i + 1).map((b) => b.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  if (e20[i] == null || e50[i] == null) return null;
  const candle = bars[i];
  const a = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14)[i] || candle.close * 0.02;
  const crossUp = e20[i - 1] <= e50[i - 1] && e20[i] > e50[i];
  const crossDown = e20[i - 1] >= e50[i - 1] && e20[i] < e50[i];
  if (crossUp) return { type: "LONG", sl: candle.close - 2 * a, tp: candle.close + 4 * a, reason: "ema_cross_long" };
  if (crossDown) return { type: "SHORT", sl: candle.close + 2 * a, tp: candle.close - 4 * a, reason: "ema_cross_short" };
  return null;
}

export const STRATEGIES = {
  fib_retrace: fibRetraceStrategy,
  fib_extension: fibExtensionStrategy,
  breakout: breakoutStrategy,
  trend_follow: trendFollowStrategy,
};

export const STRATEGY_LABELS = {
  fib_retrace: "Fibonacci Retracement (pullback)",
  fib_extension: "Fibonacci Extension (momentum)",
  breakout: "Range Breakout",
  trend_follow: "EMA Trend (baseline)",
};
