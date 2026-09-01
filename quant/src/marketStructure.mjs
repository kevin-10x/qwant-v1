// marketStructure.mjs — swing highs/lows, market-structure trend classification,
// and a range detector. This is the "market" half of the market + Fibonacci edge.

// Find swing points: a bar whose high is the max of the surrounding `left`+`right`
// window (and strictly greater than its immediate neighbors). Same for lows.
export function swingPoints(bars, left = 3, right = 3) {
  const highs = [];
  const lows = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) { isHigh = false; break; }
    }
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].low <= bars[i].low) { isLow = false; break; }
    }
    if (isHigh) highs.push({ index: i, price: bars[i].high });
    if (isLow) lows.push({ index: i, price: bars[i].low });
  }
  return { highs, lows };
}

function isHH(current, prev) {
  return prev == null || current.price > prev.price;
}
function isHL(current, prev) {
  return prev == null || current.price > prev.price; // "higher low"
}

export function trendOf(bars, swingLeft = 3, swingRight = 3) {
  const { highs, lows } = swingPoints(bars, swingLeft, swingRight);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const prevHigh = highs[highs.length - 2];
  const prevLow = lows[lows.length - 2];

  // Sequence of swing highs/lows for "HH/HL/LH/LL" patterns.
  const highsAfter = highs.filter((h) => lastLow && h.index > lastLow.index);
  const lowsBefore = lows.filter((l) => lastHigh && l.index < lastHigh.index);

  let structure = "neutral";
  if (lastLow && prevLow && lastLow.price > prevLow.price && highsAfter.length) {
    structure = "bullish"; // higher low confirmed with a rising high
  } else if (lastHigh && prevHigh && lastHigh.price < prevHigh.price && lowsBefore.length) {
    structure = "bearish"; // lower high with a falling low
  }

  return {
    structure,
    lastHigh: lastHigh ? { index: lastHigh.index, price: lastHigh.price } : null,
    lastLow: lastLow ? { index: lastLow.index, price: lastLow.price } : null,
    prevHigh: prevHigh ? { index: prevHigh.index, price: prevHigh.price } : null,
    prevLow: prevLow ? { index: prevLow.index, price: prevLow.price } : null,
  };
}

// True-range-based range detector (narrow ATR vs price).
export function detectRange(bars, atrValues) {
  const last = bars[bars.length - 1];
  const a = atrValues[atrValues.length - 1];
  if (!last || a == null || !last.close) return false;
  return a / last.close < 0.012; // ~1.2% ATR -> rangey/low-vol regime
}
