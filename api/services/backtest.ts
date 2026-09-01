import { fetchMarketData, type OHLCV } from "./market-data.js";
import { calculateIndicators } from "./indicators.js";
import { getAIModel } from "./ai-engine.js";

export interface BacktestConfig {
  symbol: string;
  market: "crypto" | "forex" | "stocks" | "commodities";
  timeframe: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  riskPerTrade: number;
  strategy: "ai" | "rsi" | "macd" | "ema_cross";
  minConfidence?: number;
}

export interface Trade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  type: "LONG" | "SHORT";
  profit: number;
  profitPercent: number;
  exitReason: "tp" | "sl" | "signal";
}

export interface BacktestResult {
  symbol: string;
  strategy: string;
  period: string;
  initialBalance: number;
  finalBalance: number;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  trades: Trade[];
  equityCurve: { date: Date; equity: number }[];
}

// Run backtest
export async function runBacktest(
  config: BacktestConfig
): Promise<BacktestResult> {
  const {
    symbol,
    market,
    timeframe,
    initialBalance,
    riskPerTrade,
    strategy,
    minConfidence = 80,
  } = config;

  // Fetch historical data
  const data = await fetchMarketData(symbol, market, timeframe, 500);

  if (data.length < 100) {
    throw new Error("Insufficient historical data for backtesting");
  }

  const trades: Trade[] = [];
  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  const equityCurve: { date: Date; equity: number }[] = [];

  let currentPosition: {
    entryIndex: number;
    entryPrice: number;
    type: "LONG" | "SHORT";
    stopLoss: number;
    takeProfit: number;
  } | null = null;

  // Simulate trading
  for (let i = 50; i < data.length - 1; i++) {
    const window = data.slice(0, i + 1);
    const candle = data[i];
    const nextCandle = data[i + 1];

    // Update equity curve
    equityCurve.push({ date: candle.timestamp, equity: balance });

    // Update drawdown
    if (balance > peakBalance) {
      peakBalance = balance;
    }
    const currentDrawdown = peakBalance - balance;
    const currentDrawdownPercent = (currentDrawdown / peakBalance) * 100;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
      maxDrawdownPercent = currentDrawdownPercent;
    }

    // Check if we have an open position
    if (currentPosition) {
      const shouldClose = await checkExit(
        currentPosition,
        candle,
        nextCandle,
        strategy,
        window
      );

      if (shouldClose.shouldClose) {
        const profit =
          currentPosition.type === "LONG"
            ? (shouldClose.exitPrice - currentPosition.entryPrice) *
              (balance * (riskPerTrade / 100)) /
              Math.abs(currentPosition.entryPrice - currentPosition.stopLoss)
            : (currentPosition.entryPrice - shouldClose.exitPrice) *
              (balance * (riskPerTrade / 100)) /
              Math.abs(currentPosition.stopLoss - currentPosition.entryPrice);

        const trade: Trade = {
          entryIndex: currentPosition.entryIndex,
          exitIndex: i,
          entryPrice: currentPosition.entryPrice,
          exitPrice: shouldClose.exitPrice,
          type: currentPosition.type,
          profit,
          profitPercent: (profit / initialBalance) * 100,
          exitReason: shouldClose.reason,
        };

        trades.push(trade);
        balance += profit;
        currentPosition = null;
      }
    } else {
      // Look for entry signal
      const signal = await generateEntrySignal(window, strategy, minConfidence);

      if (signal) {
        const stopLoss =
          signal.type === "LONG"
            ? candle.close * 0.985
            : candle.close * 1.015;
        const takeProfit =
          signal.type === "LONG"
            ? candle.close * 1.03
            : candle.close * 0.97;

        currentPosition = {
          entryIndex: i,
          entryPrice: candle.close,
          type: signal.type,
          stopLoss,
          takeProfit,
        };
      }
    }
  }

  // Close any open position at the end
  if (currentPosition) {
    const lastCandle = data[data.length - 1];
    const profit =
      currentPosition.type === "LONG"
        ? (lastCandle.close - currentPosition.entryPrice) *
          (balance * (riskPerTrade / 100)) /
          Math.abs(currentPosition.entryPrice - currentPosition.stopLoss)
        : (currentPosition.entryPrice - lastCandle.close) *
          (balance * (riskPerTrade / 100)) /
          Math.abs(currentPosition.stopLoss - currentPosition.entryPrice);

    trades.push({
      entryIndex: currentPosition.entryIndex,
      exitIndex: data.length - 1,
      entryPrice: currentPosition.entryPrice,
      exitPrice: lastCandle.close,
      type: currentPosition.type,
      profit,
      profitPercent: (profit / initialBalance) * 100,
      exitReason: "signal",
    });

    balance += profit;
  }

  // Calculate metrics
  const winningTrades = trades.filter((t) => t.profit > 0);
  const losingTrades = trades.filter((t) => t.profit <= 0);
  const totalTrades = trades.length;

  const avgWin =
    winningTrades.length > 0
      ? winningTrades.reduce((s, t) => s + t.profit, 0) / winningTrades.length
      : 0;

  const avgLoss =
    losingTrades.length > 0
      ? Math.abs(
          losingTrades.reduce((s, t) => s + t.profit, 0) / losingTrades.length
        )
      : 0;

  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

  const returns = equityCurve.map((e) => (e.equity - initialBalance) / initialBalance);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length
  );
  const sharpeRatio = stdReturn > 0 ? (avgReturn * Math.sqrt(252)) / stdReturn : 0;

  return {
    symbol,
    strategy,
    period: `${data[0].timestamp.toLocaleDateString()} - ${data[data.length - 1].timestamp.toLocaleDateString()}`,
    initialBalance,
    finalBalance: balance,
    totalReturn: ((balance - initialBalance) / initialBalance) * 100,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio,
    trades,
    equityCurve,
  };
}

async function generateEntrySignal(
  data: OHLCV[],
  strategy: string,
  minConfidence: number
): Promise<{ type: "LONG" | "SHORT" } | null> {
  const indicators = calculateIndicators(data);

  switch (strategy) {
    case "ai": {
      const model = getAIModel();
      const prediction = await model.predict(data);
      if (prediction.confidence >= minConfidence && prediction.signal !== "HOLD") {
        return {
          type: prediction.signal === "BUY" ? "LONG" : "SHORT",
        };
      }
      return null;
    }

    case "rsi": {
      if (indicators.rsi14 && indicators.rsi14 < 30) return { type: "LONG" };
      if (indicators.rsi14 && indicators.rsi14 > 70) return { type: "SHORT" };
      return null;
    }

    case "macd": {
      if (indicators.macdHistogram && indicators.macdHistogram > 0) return { type: "LONG" };
      if (indicators.macdHistogram && indicators.macdHistogram < 0) return { type: "SHORT" };
      return null;
    }

    case "ema_cross": {
      if (indicators.ema20 && indicators.ema50 && indicators.ema20 > indicators.ema50)
        return { type: "LONG" };
      if (indicators.ema20 && indicators.ema50 && indicators.ema20 < indicators.ema50)
        return { type: "SHORT" };
      return null;
    }

    default:
      return null;
  }
}

async function checkExit(
  position: {
    type: "LONG" | "SHORT";
    stopLoss: number;
    takeProfit: number;
  },
  candle: OHLCV,
  _nextCandle: OHLCV,
  strategy: string,
  data: OHLCV[]
): Promise<{ shouldClose: boolean; exitPrice: number; reason: "tp" | "sl" | "signal" }> {
  // Check stop loss and take profit
  if (position.type === "LONG") {
    if (candle.low <= position.stopLoss) {
      return { shouldClose: true, exitPrice: position.stopLoss, reason: "sl" };
    }
    if (candle.high >= position.takeProfit) {
      return { shouldClose: true, exitPrice: position.takeProfit, reason: "tp" };
    }
  } else {
    if (candle.high >= position.stopLoss) {
      return { shouldClose: true, exitPrice: position.stopLoss, reason: "sl" };
    }
    if (candle.low <= position.takeProfit) {
      return { shouldClose: true, exitPrice: position.takeProfit, reason: "tp" };
    }
  }

  // Check for signal reversal
  if (strategy === "ai") {
    const model = getAIModel();
    const prediction = await model.predict(data);
    if (
      (position.type === "LONG" && prediction.signal === "SELL") ||
      (position.type === "SHORT" && prediction.signal === "BUY")
    ) {
      return { shouldClose: true, exitPrice: candle.close, reason: "signal" };
    }
  }

  return { shouldClose: false, exitPrice: candle.close, reason: "signal" };
}
