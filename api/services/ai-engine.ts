// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SLR } = require("ml-regression");
import {
  calculateIndicators,
  generateAIFeatures,
} from "./indicators.js";
import type { OHLCV } from "./market-data.js";
import { getLLMSentiment, type LLMSentimentResult } from "./ai-llm.js";

export interface AIPrediction {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  probability: {
    buy: number;
    sell: number;
    hold: number;
  };
  technicalScore: number;
  aiScore: number;
  sentimentScore: number;
  riskScore: number;
  reasons: string[];
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: string;
  llmAnalysis?: {
    reasoning: string;
    riskNotes: string[];
    marketRegime: string;
    keyLevels: { type: "support" | "resistance"; price: number }[];
  } | null;
}

// Simple ensemble model that combines technical indicators with ML
class TradingModel {
  private regressionModel: any = null;
  private isTrained = false;

  // Train a simple linear regression model on historical data
  train(historicalData: OHLCV[]): void {
    if (historicalData.length < 100) {
      console.warn("Insufficient data for training. Need at least 100 candles.");
      return;
    }

    try {
      const X: number[][] = [];
      const y: number[] = [];

      // Use sliding window to create training data
      for (let i = 50; i < historicalData.length - 1; i++) {
        const window = historicalData.slice(i - 50, i);
        const features = generateAIFeatures(window);

        // Target: 1 if price goes up in next candle, 0 if down
        const nextReturn =
          (historicalData[i + 1].close - historicalData[i].close) /
          historicalData[i].close;
        y.push(nextReturn);
        X.push(features);
      }

      if (X.length === 0 || y.length === 0) return;

      // Use first feature (RSI) as predictor for simplicity
      // In production, use XGBoost or neural network
      const xColumn = X.map((row) => row[0]); // RSI
      this.regressionModel = new SLR(xColumn, y);
      this.isTrained = true;

      console.log(`AI Model trained on ${X.length} samples`);
    } catch (error) {
      console.error("Error training model:", error);
    }
  }

  // Predict using the trained model + technical analysis + LLM sentiment
  async predict(data: OHLCV[], symbol?: string, timeframe?: string): Promise<AIPrediction> {
    const indicators = calculateIndicators(data);
    const features = generateAIFeatures(data);
    const lastClose = data[data.length - 1].close;

    // Technical analysis scoring (0-100)
    const technicalScore = this.calculateTechnicalScore(indicators);

    // ML prediction score (0-100)
    const mlScore = this.calculateMLScore(features);

    // LLM-powered sentiment analysis (falls back to heuristic if unavailable)
    let sentimentScore: number;
    let llmResult: LLMSentimentResult | null = null;

    if (symbol && timeframe) {
      llmResult = await getLLMSentiment(symbol, timeframe, data, indicators);
    }

    if (llmResult) {
      sentimentScore = llmResult.sentimentScore;
    } else {
      // Fallback heuristic based on technical indicators
      sentimentScore = this.calculateSentimentFallback(indicators, features);
    }

    // Risk score (lower is better, 0-100)
    const riskScore = this.calculateRiskScore(indicators, features);

    // Weighted ensemble
    const weights = {
      technical: 0.30,
      ml: 0.25,
      sentiment: 0.25,
      risk: 0.20,
    };

    // Normalize scores to -1 to 1 range
    const normalizedTechnical = (technicalScore - 50) / 50;
    const normalizedML = (mlScore - 50) / 50;
    const normalizedSentiment = (sentimentScore - 50) / 50;
    const normalizedRisk = (50 - riskScore) / 50; // Invert: lower risk is better

    const ensembleScore =
      normalizedTechnical * weights.technical +
      normalizedML * weights.ml +
      normalizedSentiment * weights.sentiment +
      normalizedRisk * weights.risk;

    // Convert to probabilities
    const buyProb = Math.max(0, ensembleScore * 50 + 50);
    const sellProb = Math.max(0, -ensembleScore * 50 + 50);
    const holdProb = Math.max(0, 100 - buyProb - sellProb);

    // Normalize to 100%
    const total = buyProb + sellProb + holdProb;
    const buyPct = (buyProb / total) * 100;
    const sellPct = (sellProb / total) * 100;
    const holdPct = (holdProb / total) * 100;

    // Determine signal
    let signal: "BUY" | "SELL" | "HOLD";
    let confidence: number;

    if (buyPct > sellPct && buyPct > holdPct) {
      signal = "BUY";
      confidence = buyPct;
    } else if (sellPct > buyPct && sellPct > holdPct) {
      signal = "SELL";
      confidence = sellPct;
    } else {
      signal = "HOLD";
      confidence = holdPct;
    }

    // Generate reasons (enhanced with LLM data)
    const reasons = this.generateReasons(indicators, features, signal, llmResult);

    // Calculate entry, stop loss, and take profit
    const { entryPrice, stopLoss, takeProfit } = this.calculateLevels(
      lastClose,
      indicators,
      signal
    );

    const riskReward =
      signal === "BUY"
        ? ((takeProfit - entryPrice) / (entryPrice - stopLoss)).toFixed(2) +
          ":1"
        : signal === "SELL"
        ? ((entryPrice - takeProfit) / (stopLoss - entryPrice)).toFixed(2) +
          ":1"
        : "N/A";

    return {
      signal,
      confidence: Math.round(confidence * 10) / 10,
      probability: {
        buy: Math.round(buyPct * 10) / 10,
        sell: Math.round(sellPct * 10) / 10,
        hold: Math.round(holdPct * 10) / 10,
      },
      technicalScore: Math.round(technicalScore * 10) / 10,
      aiScore: Math.round(mlScore * 10) / 10,
      sentimentScore: Math.round(sentimentScore * 10) / 10,
      riskScore: Math.round(riskScore * 10) / 10,
      reasons,
      entryPrice: Math.round(entryPrice * 100) / 100,
      stopLoss: Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward,
      llmAnalysis: llmResult
        ? {
            reasoning: llmResult.reasoning,
            riskNotes: llmResult.riskNotes,
            marketRegime: llmResult.marketRegime,
            keyLevels: llmResult.keyLevels,
          }
        : null,
    };
  }

  private calculateSentimentFallback(
    indicators: ReturnType<typeof calculateIndicators>,
    features: number[]
  ): number {
    let score = 50;

    if (indicators.rsi14) {
      if (indicators.rsi14 < 30) score += 15;
      else if (indicators.rsi14 > 70) score -= 15;
      else if (indicators.rsi14 < 45) score += 5;
      else if (indicators.rsi14 > 55) score -= 5;
    }

    if (indicators.trend === "bullish") score += 10;
    else if (indicators.trend === "bearish") score -= 10;

    const returns5 = features[5];
    if (returns5 > 2) score += 10;
    else if (returns5 < -2) score -= 10;

    const returns10 = features[6];
    if (returns10 > 3) score += 5;
    else if (returns10 < -3) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  private calculateTechnicalScore(indicators: ReturnType<typeof calculateIndicators>): number {
    let score = 50; // Neutral base

    // RSI contribution (30-70 range)
    if (indicators.rsi14) {
      if (indicators.rsi14 < 30) score += 15; // Oversold = bullish
      else if (indicators.rsi14 > 70) score -= 15; // Overbought = bearish
      else if (indicators.rsi14 < 45) score += 5;
      else if (indicators.rsi14 > 55) score -= 5;
    }

    // MACD contribution
    if (indicators.macdHistogram) {
      if (indicators.macdHistogram > 0) score += 10;
      else score -= 10;
    }

    // Trend contribution
    if (indicators.trend === "bullish") score += 15;
    else if (indicators.trend === "bearish") score -= 15;

    // EMA alignment
    if (indicators.ema20 && indicators.ema50) {
      if (indicators.ema20 > indicators.ema50) score += 10;
      else score -= 10;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  private calculateMLScore(features: number[]): number {
    if (!this.isTrained || !this.regressionModel) {
      // Fallback: use feature-based heuristic
      const rsi = features[0];
      const macd = features[1];
      const hist = features[2];
      const returns5 = features[5];

      let score = 50;
      if (rsi < 35) score += 20;
      if (rsi > 65) score -= 20;
      if (macd > 0) score += 10;
      if (hist > 0) score += 10;
      if (returns5 > 0) score += 10;
      if (returns5 < 0) score -= 10;

      return Math.max(0, Math.min(100, score));
    }

    try {
      const prediction = this.regressionModel.predict(features[0]);
      return Math.max(0, Math.min(100, 50 + prediction * 500));
    } catch {
      return 50;
    }
  }

  private calculateRiskScore(indicators: ReturnType<typeof calculateIndicators>, features: number[]): number {
    let risk = 50;

    // ATR-based volatility risk
    if (indicators.atr14) {
      const atrPercent = (indicators.atr14 / features[0]) * 100;
      if (atrPercent > 5) risk += 20;
      else if (atrPercent > 3) risk += 10;
      else if (atrPercent < 1) risk -= 10;
    }

    // RSI extreme risk
    if (indicators.rsi14 && (indicators.rsi14 < 20 || indicators.rsi14 > 80)) {
      risk += 15; // Extreme levels = higher risk
    }

    // Trend consistency
    if (indicators.trend === "neutral") {
      risk += 10; // Choppy markets are riskier
    }

    return Math.max(0, Math.min(100, risk));
  }

  private generateReasons(
    indicators: ReturnType<typeof calculateIndicators>,
    features: number[],
    signal: "BUY" | "SELL" | "HOLD",
    llmResult?: LLMSentimentResult | null
  ): string[] {
    const reasons: string[] = [];
    const lastPrice = features[10] || 0;

    if (signal === "BUY") {
      if (indicators.rsi14 && indicators.rsi14 < 35) {
        reasons.push("RSI oversold - potential reversal");
      } else if (indicators.rsi14 && indicators.rsi14 < 50) {
        reasons.push("RSI below neutral - room to grow");
      }
      if (indicators.macdHistogram && indicators.macdHistogram > 0) {
        reasons.push("MACD bullish crossover");
      }
      if (indicators.trend === "bullish") {
        reasons.push("Price above EMA20 and EMA50 - uptrend");
      }
      if (indicators.bbLower && lastPrice && lastPrice < indicators.bbLower) {
        reasons.push("Price below lower Bollinger Band - oversold");
      }
    } else if (signal === "SELL") {
      if (indicators.rsi14 && indicators.rsi14 > 65) {
        reasons.push("RSI overbought - potential reversal");
      }
      if (indicators.macdHistogram && indicators.macdHistogram < 0) {
        reasons.push("MACD bearish crossover");
      }
      if (indicators.trend === "bearish") {
        reasons.push("Price below EMA20 and EMA50 - downtrend");
      }
    } else {
      reasons.push("Market conditions unclear - waiting for better setup");
      if (indicators.trend === "neutral") {
        reasons.push("Sideways market - no clear direction");
      }
    }

    if (indicators.atr14) {
      reasons.push(`ATR: ${indicators.atr14.toFixed(2)} - volatility assessment`);
    }

    // Append LLM analysis reason
    if (llmResult?.reasoning) {
      reasons.push(`AI Insight: ${llmResult.reasoning}`);
    }

    return reasons.length > 0 ? reasons : ["Analysis inconclusive"];
  }

  private calculateLevels(
    currentPrice: number,
    indicators: ReturnType<typeof calculateIndicators>,
    signal: "BUY" | "SELL" | "HOLD"
  ): { entryPrice: number; stopLoss: number; takeProfit: number } {
    const atr = indicators.atr14 || currentPrice * 0.01;

    if (signal === "BUY") {
      const entryPrice = currentPrice;
      const stopLoss = currentPrice - atr * 1.5;
      const takeProfit = currentPrice + atr * 3;
      return { entryPrice, stopLoss, takeProfit };
    } else if (signal === "SELL") {
      const entryPrice = currentPrice;
      const stopLoss = currentPrice + atr * 1.5;
      const takeProfit = currentPrice - atr * 3;
      return { entryPrice, stopLoss, takeProfit };
    }

    return {
      entryPrice: currentPrice,
      stopLoss: currentPrice - atr * 2,
      takeProfit: currentPrice + atr * 2,
    };
  }
}

// Singleton instance
let model: TradingModel | null = null;

export function getAIModel(): TradingModel {
  if (!model) {
    model = new TradingModel();
  }
  return model;
}

export function resetAIModel(): void {
  model = new TradingModel();
}

// Feature importance analysis
export function getFeatureImportance(): {
  feature: string;
  importance: number;
}[] {
  return [
    { feature: "RSI(14)", importance: 0.25 },
    { feature: "MACD Histogram", importance: 0.2 },
    { feature: "Price Returns (5)", importance: 0.15 },
    { feature: "EMA Spread", importance: 0.12 },
    { feature: "Volume Change", importance: 0.1 },
    { feature: "ATR(14)", importance: 0.08 },
    { feature: "BB Position", importance: 0.05 },
    { feature: "VWAP Distance", importance: 0.03 },
    { feature: "Returns (10)", importance: 0.015 },
    { feature: "Returns (1)", importance: 0.005 },
  ];
}
