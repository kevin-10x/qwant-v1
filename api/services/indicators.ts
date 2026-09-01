import type { OHLCV } from "./market-data.js";

export interface IndicatorValues {
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  ema20: number | null;
  ema50: number | null;
  sma20: number | null;
  sma50: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr14: number | null;
  vwap: number | null;
  trend: "bullish" | "bearish" | "neutral";
  support: number | null;
  resistance: number | null;
}

// Simple Moving Average
function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result.push(sum / period);
  }
  return result;
}

// Exponential Moving Average
function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0]);
    } else if (i < period - 1) {
      // Use SMA for initial values
      const slice = data.slice(0, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      result.push(avg);
    } else {
      result.push(
        (data[i] - result[i - 1]) * multiplier + result[i - 1]
      );
    }
  }
  return result;
}

// RSI (Relative Strength Index)
function rsi(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  let gains = 0;
  let losses = 0;

  // First RSI calculation
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push(NaN);
      continue;
    }

    if (i > period) {
      const change = data[i] - data[i - 1];
      avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
      avgLoss =
        (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) /
        period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

// MACD (Moving Average Convergence Divergence)
function macd(
  data: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);

  const macdLine = emaFast.map((v, i) =>
    isNaN(v) || isNaN(emaSlow[i]) ? NaN : v - emaSlow[i]
  );

  // Filter out NaN for signal calculation
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalLineFull = ema(validMacd, signal);

  // Pad signal line to match original length
  const signalLine = macdLine.map((v) =>
    isNaN(v) ? NaN : signalLineFull[validMacd.indexOf(v)] ?? NaN
  );

  const histogram = macdLine.map((v, i) =>
    isNaN(v) || isNaN(signalLine[i]) ? NaN : v - signalLine[i]
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

// Bollinger Bands
function bollingerBands(
  data: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance =
      slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    upper.push(middle[i] + stdDev * std);
    lower.push(middle[i] - stdDev * std);
  }

  return { upper, middle, lower };
}

// ATR (Average True Range)
function atr(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14
): number[] {
  const trueRanges: number[] = [];

  for (let i = 0; i < close.length; i++) {
    if (i === 0) {
      trueRanges.push(high[i] - low[i]);
      continue;
    }

    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i - 1]);
    const tr3 = Math.abs(low[i] - close[i - 1]);

    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  // Use EMA for ATR calculation (Wilder's smoothing)
  const result: number[] = [];
  let atrVal = 0;

  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period) {
      result.push(NaN);
      if (i === period - 1) {
        atrVal =
          trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
      }
      continue;
    }

    if (i === period) {
      atrVal = (atrVal * (period - 1) + trueRanges[i]) / period;
    } else {
      atrVal = (atrVal * (period - 1) + trueRanges[i]) / period;
    }

    result.push(atrVal);
  }

  return result;
}

// VWAP (Volume Weighted Average Price)
function vwap(
  high: number[],
  low: number[],
  close: number[],
  volume: number[]
): number[] {
  const result: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVol = 0;

  for (let i = 0; i < close.length; i++) {
    const typicalPrice = (high[i] + low[i] + close[i]) / 3;
    const tpv = typicalPrice * volume[i];

    cumulativeTPV += tpv;
    cumulativeVol += volume[i];

    result.push(cumulativeVol === 0 ? 0 : cumulativeTPV / cumulativeVol);
  }

  return result;
}

// Support and Resistance levels
function findLevels(
  data: number[],
  period: number = 20
): { support: number | null; resistance: number | null } {
  if (data.length < period) {
    return { support: null, resistance: null };
  }

  const recent = data.slice(-period);
  const min = Math.min(...recent);
  const max = Math.max(...recent);

  return { support: min, resistance: max };
}

// Trend detection
function detectTrend(
  ema20: number[],
  ema50: number[],
  close: number[]
): "bullish" | "bearish" | "neutral" {
  const lastIndex = close.length - 1;
  const currentEma20 = ema20[lastIndex];
  const currentEma50 = ema50[lastIndex];
  const price = close[lastIndex];

  if (isNaN(currentEma20) || isNaN(currentEma50)) {
    return "neutral";
  }

  if (price > currentEma20 && currentEma20 > currentEma50) {
    return "bullish";
  }

  if (price < currentEma20 && currentEma20 < currentEma50) {
    return "bearish";
  }

  return "neutral";
}

// Main function to calculate all indicators
export function calculateIndicators(data: OHLCV[]): IndicatorValues {
  if (data.length < 50) {
    return {
      rsi14: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      ema20: null,
      ema50: null,
      sma20: null,
      sma50: null,
      bbUpper: null,
      bbMiddle: null,
      bbLower: null,
      atr14: null,
      vwap: null,
      trend: "neutral",
      support: null,
      resistance: null,
    };
  }

  const closes = data.map((d) => d.close);
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const volumes = data.map((d) => d.volume);

  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes);
  const ema20Values = ema(closes, 20);
  const ema50Values = ema(closes, 50);
  const sma20Values = sma(closes, 20);
  const sma50Values = sma(closes, 50);
  const bbResult = bollingerBands(closes);
  const atrValues = atr(highs, lows, closes, 14);
  const vwapValues = vwap(highs, lows, closes, volumes);
  const levels = findLevels(closes);
  const trend = detectTrend(ema20Values, ema50Values, closes);

  const lastIndex = closes.length - 1;

  return {
    rsi14: rsiValues[lastIndex] || null,
    macd: macdResult.macd[lastIndex] || null,
    macdSignal: macdResult.signal[lastIndex] || null,
    macdHistogram: macdResult.histogram[lastIndex] || null,
    ema20: ema20Values[lastIndex] || null,
    ema50: ema50Values[lastIndex] || null,
    sma20: sma20Values[lastIndex] || null,
    sma50: sma50Values[lastIndex] || null,
    bbUpper: bbResult.upper[lastIndex] || null,
    bbMiddle: bbResult.middle[lastIndex] || null,
    bbLower: bbResult.lower[lastIndex] || null,
    atr14: atrValues[lastIndex] || null,
    vwap: vwapValues[lastIndex] || null,
    trend,
    support: levels.support,
    resistance: levels.resistance,
  };
}

// Generate features for AI model
export function generateAIFeatures(data: OHLCV[]): number[] {
  const indicators = calculateIndicators(data);
  const closes = data.map((d) => d.close);
  const lastClose = closes[closes.length - 1];

  // Price changes
  const returns1 = (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2];
  const returns5 = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
  const returns10 = (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11];

  // Price position within Bollinger Bands
  const bbPosition = indicators.bbUpper && indicators.bbLower
    ? (lastClose - indicators.bbLower) / (indicators.bbUpper - indicators.bbLower)
    : 0.5;

  // Volume change
  const volumes = data.map((d) => d.volume);
  const volumeChange = (volumes[volumes.length - 1] - volumes[volumes.length - 2]) / volumes[volumes.length - 2];

  // Trend strength
  const emaDiff = indicators.ema20 && indicators.ema50
    ? (indicators.ema20 - indicators.ema50) / lastClose * 100
    : 0;

  return [
    indicators.rsi14 || 50,
    indicators.macd || 0,
    indicators.macdHistogram || 0,
    indicators.atr14 || 0,
    bbPosition,
    returns1 * 100,
    returns5 * 100,
    returns10 * 100,
    volumeChange * 100,
    emaDiff,
    indicators.sma20 ? (lastClose - indicators.sma20) / lastClose * 100 : 0,
    indicators.vwap ? (lastClose - indicators.vwap) / lastClose * 100 : 0,
  ];
}
