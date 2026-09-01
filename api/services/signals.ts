import { getAIModel, type AIPrediction } from "./ai-engine.js";
import { calculateIndicators } from "./indicators.js";
import { fetchMarketData } from "./market-data.js";

export interface SignalConfig {
  minConfidence: number;
  maxRiskScore: number;
  riskPerTrade: number; // % of account
  maxDailyLoss: number; // % of account
  minVolume: number;
  allowedMarkets: ("crypto" | "forex" | "stocks" | "commodities")[];
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  minConfidence: 80,
  maxRiskScore: 70,
  riskPerTrade: 2,
  maxDailyLoss: 5,
  minVolume: 100000,
  allowedMarkets: ["crypto", "forex", "stocks", "commodities"],
};

export interface GeneratedSignal extends AIPrediction {
  symbol: string;
  market: "crypto" | "forex" | "stocks" | "commodities";
  timeframe: string;
  timestamp: Date;
  passedRiskCheck: boolean;
  riskMessage?: string;
}

export interface RiskCheck {
  passed: boolean;
  message?: string;
  positionSize?: number;
}

// Generate trading signal for a symbol
export async function generateSignal(
  symbol: string,
  market: "crypto" | "forex" | "stocks" | "commodities",
  timeframe: string = "1h",
  config: Partial<SignalConfig> = {}
): Promise<GeneratedSignal | null> {
  const fullConfig = { ...DEFAULT_SIGNAL_CONFIG, ...config };

  try {
    // Fetch market data
    const data = await fetchMarketData(symbol, market, timeframe, 100);

    if (data.length < 50) {
      return null;
    }

    // Get AI prediction
    const model = getAIModel();
    const prediction = await model.predict(data, symbol, timeframe);

    // Risk check
    const riskCheck = checkRisk(prediction, fullConfig);

    // Only return signals that pass minimum confidence
    if (prediction.confidence < fullConfig.minConfidence) {
      return {
        ...prediction,
        symbol,
        market,
        timeframe,
        timestamp: new Date(),
        passedRiskCheck: false,
        riskMessage: `Confidence ${prediction.confidence}% below threshold ${fullConfig.minConfidence}%`,
      };
    }

    return {
      ...prediction,
      symbol,
      market,
      timeframe,
      timestamp: new Date(),
      passedRiskCheck: riskCheck.passed,
      riskMessage: riskCheck.message,
    };
  } catch (error) {
    console.error(`Error generating signal for ${symbol}:`, error);
    return null;
  }
}

// Check risk parameters
function checkRisk(
  prediction: AIPrediction,
  config: SignalConfig
): RiskCheck {
  // Check risk score
  if (prediction.riskScore > config.maxRiskScore) {
    return {
      passed: false,
      message: `Risk score ${prediction.riskScore} exceeds maximum ${config.maxRiskScore}`,
    };
  }

  // Check confidence
  if (prediction.confidence < config.minConfidence) {
    return {
      passed: false,
      message: `Confidence ${prediction.confidence}% below minimum ${config.minConfidence}%`,
    };
  }

  // Calculate position size based on risk
  const accountRisk = config.riskPerTrade / 100;
  const stopDistance = Math.abs(prediction.entryPrice - prediction.stopLoss);
  const positionSize =
    stopDistance > 0
      ? (10000 * accountRisk) / stopDistance // Assuming $10k account
      : 0;

  return {
    passed: true,
    positionSize,
  };
}

// Scan multiple symbols for signals
export async function scanMarkets(
  symbols: Array<{
    symbol: string;
    market: "crypto" | "forex" | "stocks" | "commodities";
  }>,
  config: Partial<SignalConfig> = {}
): Promise<GeneratedSignal[]> {
  const signals: GeneratedSignal[] = [];

  for (const { symbol, market } of symbols) {
    const signal = await generateSignal(symbol, market, "1h", config);
    if (signal && signal.signal !== "HOLD" && signal.passedRiskCheck) {
      signals.push(signal);
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Sort by confidence (highest first)
  return signals.sort((a, b) => b.confidence - a.confidence);
}

// Get signal history for a symbol
export async function getSignalHistory(
  symbol: string,
  market: "crypto" | "forex" | "stocks" | "commodities",
  lookback: number = 100
): Promise<
  Array<{
    timestamp: Date;
    close: number;
    indicators: ReturnType<typeof calculateIndicators>;
  }>
> {
  const data = await fetchMarketData(symbol, market, "1h", lookback);
  const history: Array<{
    timestamp: Date;
    close: number;
    indicators: ReturnType<typeof calculateIndicators>;
  }> = [];

  for (let i = 50; i < data.length; i++) {
    const window = data.slice(0, i + 1);
    const indicators = calculateIndicators(window);
    history.push({
      timestamp: data[i].timestamp,
      close: data[i].close,
      indicators,
    });
  }

  return history;
}

// Market scanner - continuously scan for opportunities
export class MarketScanner {
  private isRunning = false;
  private interval: NodeJS.Timeout | null = null;
  private onSignal: ((signal: GeneratedSignal) => void) | null = null;

  start(
    symbols: Array<{
      symbol: string;
      market: "crypto" | "forex" | "stocks" | "commodities";
    }>,
    scanIntervalMs: number = 30000,
    onSignal?: (signal: GeneratedSignal) => void,
    config?: Partial<SignalConfig>
  ): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.onSignal = onSignal || null;

    const scan = async () => {
      if (!this.isRunning) return;

      try {
        const signals = await scanMarkets(symbols, config);
        for (const signal of signals) {
          if (this.onSignal) {
            this.onSignal(signal);
          }
        }
      } catch (error) {
        console.error("Market scan error:", error);
      }
    };

    // Initial scan
    scan();

    // Set up interval
    this.interval = setInterval(scan, scanIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

// Global scanner instance
let scanner: MarketScanner | null = null;

export function getMarketScanner(): MarketScanner {
  if (!scanner) {
    scanner = new MarketScanner();
  }
  return scanner;
}
