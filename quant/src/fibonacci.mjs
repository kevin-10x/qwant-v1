// fibonacci.mjs — Fibonacci retracement and extension levels from a swing leg.
// A leg is defined by swing0 (start) -> swing1 (end); retracements are measured
// INTO the swing (against the impulse), extensions project BEYOND the swing.

import { detectRange, swingPoints, trendOf } from "./marketStructure.mjs";

export const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
export const EXTENSIONS = [1.272, 1.618, 2.0, 2.618];

// Compute retracement levels for an up-leg (swing0 low -> swing1 high).
export function upLegLevels(swing0, swing1) {
  const range = swing1.price - swing0.price;
  return {
    swing0: swing0.price,
    swing1: swing1.price,
    size: range,
    retracements: RETRACEMENTS.map((r) => ({
      level: r,
      price: swing1.price - range * r,
    })),
    // Extensions above the leg high (for profit targets on longs).
    extensions: EXTENSIONS.map((e) => ({
      level: e,
      price: swing1.price + range * (e - 1),
    })),
  };
}

// Compute retracement levels for a down-leg (swing0 high -> swing1 low).
export function downLegLevels(swing0, swing1) {
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

// Build the market + fibonacci objects for a full bar series (used by both
// strategies and the daily report). Returns a snapshot of the latest state.
// `data` must be the bars up to and including the "now" bar.
export function buildFibSnapshot(bars) {
  const { highs, lows } = swingPoints(bars, 3, 3);
  const ts = trendOf(bars, 3, 3);
  const last = bars[bars.length - 1];
  const now = last.index ?? bars.length - 1;

  // The most recent completed swing leg by index.
  const candidates = [];
  for (const h of highs) candidates.push({ kind: "high", index: h.index, price: h.price });
  for (const l of lows) candidates.push({ kind: "low", index: l.index, price: l.price });
  candidates.sort((a, b) => a.index - b.index);

  // Anchor-based leg construction: take the most recent confirmed swing point,
  // then extend the leg to the actual highest/lowest price observed since it,
  // so the levels track a strong, still-forming impulse that hasn't produced a
  // new confirmed swing yet (e.g. a straight rally without a 3-bar pullback).
  let leg = null;
  if (candidates.length) {
    const lastCand = candidates[candidates.length - 1];
    if (lastCand.kind === "low") {
      // Up impulse from the last confirmed low to the highest point since.
      let highPrice = lastCand.price;
      let highIndex = lastCand.index;
      for (let j = lastCand.index; j < bars.length; j++) {
        if (bars[j].high > highPrice) { highPrice = bars[j].high; highIndex = j; }
      }
      leg = {
        force: "up",
        startIndex: lastCand.index, startPrice: lastCand.price,
        endIndex: highIndex, endPrice: highPrice,
        size: highPrice - lastCand.price,
      };
    } else {
      // Down impulse from the last confirmed high to the lowest point since.
      let lowPrice = lastCand.price;
      let lowIndex = lastCand.index;
      for (let j = lastCand.index; j < bars.length; j++) {
        if (bars[j].low < lowPrice) { lowPrice = bars[j].low; lowIndex = j; }
      }
      leg = {
        force: "down",
        startIndex: lastCand.index, startPrice: lastCand.price,
        endIndex: lowIndex, endPrice: lowPrice,
        size: lastCand.price - lowPrice,
      };
    }
  }
  const lastLeg = leg;
  const prevLeg = null;

  let levels = null;
  if (lastLeg) {
    const swing0 = { price: lastLeg.startPrice };
    const swing1 = { price: lastLeg.endPrice };
    levels =
      lastLeg.force === "up"
        ? upLegLevels(swing0, swing1)
        : downLegLevels(swing0, swing1);
    levels.force = lastLeg.force;
    levels.startIndex = lastLeg.startIndex;
    levels.endIndex = lastLeg.endIndex;
  }

  // Nearest retracement level relative to current price (for the report).
  let nearestRetracement = null;
  if (levels) {
    let best = null;
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
    prevHigh: ts.prevHigh,
    prevLow: ts.prevLow,
    price: last.close,
    lastLeg,
    prevLeg,
    levels,
    nearestRetracement,
    range: detectRange(bars, [last.close]) && false,
    swingCount: { highs: highs.length, lows: lows.length },
  };
}
