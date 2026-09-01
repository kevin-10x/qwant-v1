// marketStructure.ts — swing highs/lows, market-structure trend classification,
// and a range detector.

import type { OHLCV } from "../market-data.js";

export interface SwingPoint {
  index: number;
  price: number;
}

export interface SwingSet {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

export interface Barrier {
  index: number;
  price: number;
}

export interface TrendInfo {
  structure: "bullish" | "bearish" | "neutral";
  lastHigh: Barrier | null;
  lastLow: Barrier | null;
  prevHigh: Barrier | null;
  prevLow: Barrier | null;
}

export function swingPoints(
  bars: OHLCV[],
  left = 3,
  right = 3
): SwingSet {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) {
        isHigh = false;
        break;
      }
    }
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].low <= bars[i].low) {
        isLow = false;
        break;
      }
    }
    if (isHigh) highs.push({ index: i, price: bars[i].high });
    if (isLow) lows.push({ index: i, price: bars[i].low });
  }
  return { highs, lows };
}

export function trendOf(
  bars: OHLCV[],
  swingLeft = 3,
  swingRight = 3
): TrendInfo {
  const { highs, lows } = swingPoints(bars, swingLeft, swingRight);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const prevHigh = highs[highs.length - 2];
  const prevLow = lows[lows.length - 2];

  const highsAfter = highs.filter((h) => lastLow && h.index > lastLow.index);
  const lowsBefore = lows.filter((l) => lastHigh && l.index < lastHigh.index);

  let structure: "bullish" | "bearish" | "neutral" = "neutral";
  if (lastLow && prevLow && lastLow.price > prevLow.price && highsAfter.length) {
    structure = "bullish";
  } else if (
    lastHigh &&
    prevHigh &&
    lastHigh.price < prevHigh.price &&
    lowsBefore.length
  ) {
    structure = "bearish";
  }

  return {
    structure,
    lastHigh: lastHigh ? { index: lastHigh.index, price: lastHigh.price } : null,
    lastLow: lastLow ? { index: lastLow.index, price: lastLow.price } : null,
    prevHigh: prevHigh ? { index: prevHigh.index, price: prevHigh.price } : null,
    prevLow: prevLow ? { index: prevLow.index, price: prevLow.price } : null,
  };
}

// True-range based range detector (narrow ATR vs price).
export function detectRange(
  bars: OHLCV[],
  atrValues: (number | null)[]
): boolean {
  const last = bars[bars.length - 1];
  const a = atrValues[atrValues.length - 1];
  if (!last || a == null || !last.close) return false;
  return a / last.close < 0.012;
}