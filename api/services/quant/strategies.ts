// strategies.ts — market-structure + Fibonacci strategies.
// Each strategy is evaluated at bar index `i` using ONLY bars up to and including
// index `i` (no lookahead). Returns an entry decision or null.

import type { OHLCV } from "../market-data.js";
import { ema, rsi, atr, lastNonNull } from "./indicators.js";
import { swingPoints } from "./marketStructure.js";
import { upLegLevels, downLegLevels, EXTENSIONS } from "./fibonacci.js";

export type EntryDirection = "LONG" | "SHORT";

export interface EntryDecision {
  type: EntryDirection;
  sl: number;
  tp: number;
  reason: string;
}

export interface StrategyConfig {
  slip?: number;
  proximity?: number;
  extensionFactor?: number;
  extensionTarget?: number;
  range?: number;
  rewardRisk?: number;
}

export type StrategyFn = (
  bars: OHLCV[],
  i: number,
  cfg?: StrategyConfig
) => EntryDecision | null;

// ---- FIB RETRACEMENT: pullback into a retracement level within the prevailing swing trend. ----
export function fibRetraceStrategy(
  bars: OHLCV[],
  i: number,
  cfg: StrategyConfig = {}
): EntryDecision | null {
  const lookback = 120;
  const start = Math.max(0, i - lookback);
  const slice = bars.slice(start, i + 1);
  if (slice.length < 60) return null;

  const closes = slice.map((b) => b.close);
  const rsiNow = lastNonNull(rsi(closes, 14));
  if (rsiNow == null) return null;
  const ema50 = lastNonNull(ema(closes, 50));
  if (ema50 == null) return null;

  const { highs, lows } = swingPoints(slice, 3, 3);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  if (!lastHigh || !lastLow || lastLow.index > lastHigh.index) return null;

  const candle = bars[i];
  const prev = slice[slice.length - 2] || candle;
  const a = lastNonNull(atr(slice.map((b) => b.high), slice.map((b) => b.low), closes, 14)) || candle.close * 0.02;

  if (candle.close > ema50) {
    const leg = upLegLevels({ price: lastLow.price }, { price: lastHigh.price });
    for (const rt of leg.retracements) {
      if (rt.level < 0.236) continue;
      const touched = Math.min(prev.low, candle.low) <= rt.price + 0.25 * a;
      if (!touched) continue;
      const closedUp = candle.close >= rt.price - 0.5 * a && candle.close > prev.close;
      if (closedUp && rsiNow >= 30 && rsiNow <= 65) {
        return {
          type: "LONG",
          sl: Math.min(lastLow.price, rt.price - 1.25 * a),
          tp: lastHigh.price + (cfg.extensionFactor ?? 0) * leg.size,
          reason: `fib_retr_long@${rt.level}`,
        };
      }
    }
  }

  if (candle.close < ema50) {
    const leg = downLegLevels({ price: lastHigh.price }, { price: lastLow.price });
    for (const rt of leg.retracements) {
      if (rt.level < 0.236) continue;
      const touched = Math.max(prev.high, candle.high) >= rt.price - 0.25 * a;
      if (!touched) continue;
      const closedDown = candle.close <= rt.price + 0.5 * a && candle.close < prev.close;
      if (closedDown && rsiNow <= 70 && rsiNow >= 35) {
        return {
          type: "SHORT",
          sl: Math.max(lastHigh.price, rt.price + 1.25 * a),
          tp: lastLow.price - (cfg.extensionFactor ?? 0) * leg.size,
          reason: `fib_retr_short@${rt.level}`,
        };
      }
    }
  }
  return null;
}

// ---- FIB EXTENSION: momentum through a swing high/low, targetting +/-1.272/1.618 extensions. ----
export function fibExtensionStrategy(
  bars: OHLCV[],
  i: number,
  cfg: StrategyConfig = {}
): EntryDecision | null {
  const lookback = 120;
  const start = Math.max(0, i - lookback);
  const slice = bars.slice(start, i + 1);
  if (slice.length < 60) return null;

  const closes = slice.map((b) => b.close);
  const rsiNow = lastNonNull(rsi(closes, 14));
  if (rsiNow == null) return null;
  const a =
    lastNonNull(atr(slice.map((b) => b.high), slice.map((b) => b.low), closes, 14)) ||
    bars[i].close * 0.02;

  const { highs, lows } = swingPoints(slice, 3, 3);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const candle = bars[i];

  if (lastHigh && candle.close > lastHigh.price && (rsiNow ?? 0) > 55) {
    const leg = upLegLevels({ price: lastLow.price }, { price: lastHigh.price });
    const targetLevel = EXTENSIONS.includes((cfg.extensionTarget ?? 1.618) as never)
      ? (cfg.extensionTarget as number)
      : 1.618;
    return {
      type: "LONG",
      sl: candle.close - 2 * a,
      tp: lastHigh.price + leg.size * (targetLevel - 1),
      reason: `fib_ext_long@${targetLevel}`,
    };
  }

  if (lastLow && candle.close < lastLow.price && (rsiNow ?? 100) < 45) {
    const leg = downLegLevels({ price: lastHigh.price }, { price: lastLow.price });
    const targetLevel = EXTENSIONS.includes((cfg.extensionTarget ?? 1.618) as never)
      ? (cfg.extensionTarget as number)
      : 1.618;
    return {
      type: "SHORT",
      sl: candle.close + 2 * a,
      tp: lastLow.price - leg.size * (targetLevel - 1),
      reason: `fib_ext_short@${targetLevel}`,
    };
  }
  return null;
}

// ---- BREAKOUT: range breakout with ATR stop and fixed reward:risk target. ----
export function breakoutStrategy(
  bars: OHLCV[],
  i: number,
  cfg: StrategyConfig = {}
): EntryDecision | null {
  const n = cfg.range ?? 20;
  const start = Math.max(0, i - n);
  const window = bars.slice(start, i);
  if (window.length < n) return null;
  const candle = bars[i];
  const hi = Math.max(...window.map((b) => b.high));
  const lo = Math.min(...window.map((b) => b.low));
  const a =
    lastNonNull(
      atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14)
    ) || candle.close * 0.02;
  const rr = cfg.rewardRisk ?? 2;

  if (candle.close > hi) {
    return { type: "LONG", sl: candle.close - 1.5 * a, tp: candle.close + rr * 1.5 * a, reason: "breakout_long" };
  }
  if (candle.close < lo) {
    return { type: "SHORT", sl: candle.close + 1.5 * a, tp: candle.close - rr * 1.5 * a, reason: "breakout_short" };
  }
  return null;
}

// ---- TREND FOLLOW (baseline): EMA20/EMA50 crossover. ----
export function trendFollowStrategy(
  bars: OHLCV[],
  i: number,
  _cfg: StrategyConfig = {}
): EntryDecision | null {
  if (i < 50) return null;
  const closes = bars.slice(0, i + 1).map((b) => b.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  if (e20[i] == null || e50[i] == null) return null;
  const candle = bars[i];
  const a =
    atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14)[i] ||
    candle.close * 0.02;
  const crossUp = e20[i - 1] != null && e50[i - 1] != null && e20[i - 1]! <= e50[i - 1]! && e20[i]! > e50[i]!;
  const crossDown = e20[i - 1] != null && e50[i - 1] != null && e20[i - 1]! >= e50[i - 1]! && e20[i]! < e50[i]!;
  if (crossUp) return { type: "LONG", sl: candle.close - 2 * a, tp: candle.close + 4 * a, reason: "ema_cross_long" };
  if (crossDown) return { type: "SHORT", sl: candle.close + 2 * a, tp: candle.close - 4 * a, reason: "ema_cross_short" };
  return null;
}

export const STRATEGY_IDS = [
  "fib_retrace",
  "fib_extension",
  "breakout",
  "trend_follow",
] as const;

export type StrategyId = (typeof STRATEGY_IDS)[number];

export const STRATEGIES: Record<StrategyId, StrategyFn> = {
  fib_retrace: fibRetraceStrategy,
  fib_extension: fibExtensionStrategy,
  breakout: breakoutStrategy,
  trend_follow: trendFollowStrategy,
};

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  fib_retrace: "Fibonacci Retracement (pullback)",
  fib_extension: "Fibonacci Extension (momentum)",
  breakout: "Range Breakout",
  trend_follow: "EMA Trend (baseline)",
};

export const STRATEGY_DESCRIPTIONS: Record<StrategyId, string> = {
  fib_retrace: "Buy pullbacks to 0.382/0.5/0.618 in the direction of the swing trend",
  fib_extension: "Momentum through a swing high/low targeting 1.272-1.618 extensions",
  breakout: "Breakout of the last N-bar range with ATR stop",
  trend_follow: "EMA20/50 crossover baseline",
};