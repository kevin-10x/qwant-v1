// fibonacci.ts — Fibonacci retracement and extension levels from swing legs.

import type { OHLCV } from "../market-data";
import { swingPoints, trendOf } from "./marketStructure";

export const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
export const EXTENSIONS = [1.272, 1.618, 2.0, 2.618] as const;

export interface FibLevel {
  level: number;
  price: number;
}

export interface LegLevels {
  swing0: number;
  swing1: number;
  size: number;
  retracements: FibLevel[];
  extensions: FibLevel[];
}

export interface SwingLeg {
  force: "up" | "down";
  startIndex: number;
  startPrice: number;
  endIndex: number;
  endPrice: number;
  size: number;
}

export interface FibSnapshot {
  structure: "bullish" | "bearish" | "neutral";
  lastHigh: { price: number } | null;
  lastLow: { price: number } | null;
  price: number;
  lastLeg: SwingLeg | null;
  levels: (LegLevels & { force: "up" | "down"; startIndex: number; endIndex: number }) | null;
  nearestRetracement: FibLevel & { dist: number } | null;
  swingCount: { highs: number; lows: number };
}

export function upLegLevels(swing0: { price: number }, swing1: { price: number }): LegLevels {
  const range = swing1.price - swing0.price;
  return {
    swing0: swing0.price,
    swing1: swing1.price,
    size: range,
    retracements: RETRACEMENTS.map((r) => ({
      level: r,
      price: swing1.price - range * r,
    })),
    extensions: EXTENSIONS.map((e) => ({
      level: e,
      price: swing1.price + range * (e - 1),
    })),
  };
}

export function downLegLevels(swing0: { price: number }, swing1: { price: number }): LegLevels {
  const range = swing0.price - swing1.price;
  return {
    swing0: swing0.price,
    swing1: swing1.price,
    size: range,
    retracements: RETRACEMENTS.map((r) => ({
      level: r,
      price: swing1.price + range * r,
    })),
    extensions: EXTENSIONS.map((e) => ({
      level: e,
      price: swing1.price - range * (e - 1),
    })),
  };
}

// Build the market + fibonacci snapshot for the latest bar. The working leg is
// anchored on the most recent confirmed swing and extended to the actual extreme
// seen since, so levels track still-forming impulses.
export function buildFibSnapshot(bars: OHLCV[]): FibSnapshot {
  const { highs, lows } = swingPoints(bars, 3, 3);
  const ts = trendOf(bars, 3, 3);
  const last = bars[bars.length - 1];

  const candidates: { kind: "high" | "low"; index: number; price: number }[] = [];
  for (const h of highs) candidates.push({ kind: "high", index: h.index, price: h.price });
  for (const l of lows) candidates.push({ kind: "low", index: l.index, price: l.price });
  candidates.sort((a, b) => a.index - b.index);

  let lastLeg: SwingLeg | null = null;
  if (candidates.length) {
    const lastCand = candidates[candidates.length - 1];
    if (lastCand.kind === "low") {
      let highPrice = lastCand.price;
      let highIndex = lastCand.index;
      for (let j = lastCand.index; j < bars.length; j++) {
        if (bars[j].high > highPrice) {
          highPrice = bars[j].high;
          highIndex = j;
        }
      }
      lastLeg = {
        force: "up",
        startIndex: lastCand.index,
        startPrice: lastCand.price,
        endIndex: highIndex,
        endPrice: highPrice,
        size: highPrice - lastCand.price,
      };
    } else {
      let lowPrice = lastCand.price;
      let lowIndex = lastCand.index;
      for (let j = lastCand.index; j < bars.length; j++) {
        if (bars[j].low < lowPrice) {
          lowPrice = bars[j].low;
          lowIndex = j;
        }
      }
      lastLeg = {
        force: "down",
        startIndex: lastCand.index,
        startPrice: lastCand.price,
        endIndex: lowIndex,
        endPrice: lowPrice,
        size: lastCand.price - lowPrice,
      };
    }
  }

  let levels: FibSnapshot["levels"] = null;
  if (lastLeg) {
    const legLevels =
      lastLeg.force === "up"
        ? upLegLevels({ price: lastLeg.startPrice }, { price: lastLeg.endPrice })
        : downLegLevels({ price: lastLeg.startPrice }, { price: lastLeg.endPrice });
    levels = {
      ...legLevels,
      force: lastLeg.force,
      startIndex: lastLeg.startIndex,
      endIndex: lastLeg.endIndex,
    };
  }

  let nearestRetracement: FibSnapshot["nearestRetracement"] = null;
  if (levels) {
    let best: (FibLevel & { dist: number }) | null = null;
    for (const rt of levels.retracements) {
      const dist = Math.abs(rt.price - last.close);
      if (!best || dist < best.dist) best = { ...rt, dist };
    }
    nearestRetracement = best;
  }

  return {
    structure:
      lastLeg?.force === "up" ? "bullish" : lastLeg?.force === "down" ? "bearish" : ts.structure,
    lastHigh: lastLeg?.force === "down" ? { price: lastLeg.startPrice } : ts.lastHigh,
    lastLow: lastLeg?.force === "up" ? { price: lastLeg.startPrice } : ts.lastLow,
    price: last.close,
    lastLeg,
    levels,
    nearestRetracement,
    swingCount: { highs: highs.length, lows: lows.length },
  };
}