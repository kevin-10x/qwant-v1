import type { GeneratedSignal } from "./signals.js";

// Types for incoming MT5 EA signal payload
export interface MT5Signal {
  symbol: string;        // e.g. "EURUSD", "BTCUSDT"
  action: "BUY" | "SELL" | "CLOSE" | "MODIFY";
  price: number;         // entry/current price from MT5
  stopLoss: number;
  takeProfit: number;
  volume: number;        // lot size
  magic: number;         // EA magic number
  comment?: string;      // optional EA comment
  timestamp: string;     // ISO string from MT5
  accountId?: string;    // MT5 account ID
}

export interface MT5SignalResult {
  id: string;
  received: Date;
  signal: MT5Signal;
  converted: GeneratedSignal | null; // null for CLOSE/MODIFY
  status: "processed" | "rejected";
  reason?: string;
}

// --- In-memory circular buffer (last 100 signals) ---
const MAX_SIGNALS = 100;
const signalStore: MT5SignalResult[] = [];

function generateId(): string {
  return `mt5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Detect market type from symbol string
function detectMarket(
  symbol: string
): "crypto" | "forex" | "stocks" | "commodities" {
  // Crypto: ends with USDT, BTC, or ETH
  if (/USDT$|BTC$|ETH$/i.test(symbol)) return "crypto";
  // Forex: exactly 6 alpha characters (e.g. EURUSD)
  if (/^[A-Z]{6}$/i.test(symbol)) return "forex";
  return "stocks";
}

// Calculate risk/reward ratio string from entry, SL, TP
function calcRiskReward(entry: number, sl: number, tp: number): string {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return "N/A";
  const ratio = reward / risk;
  return `${ratio.toFixed(1)}:1`;
}

// Convert an MT5Signal to a GeneratedSignal
function convertToGeneratedSignal(
  mt5: MT5Signal
): GeneratedSignal | null {
  // CLOSE and MODIFY don't produce actionable signals
  if (mt5.action === "CLOSE" || mt5.action === "MODIFY") return null;

  const market = detectMarket(mt5.symbol);
  const signalDir: "BUY" | "SELL" | "HOLD" =
    mt5.action === "BUY" ? "BUY" : mt5.action === "SELL" ? "SELL" : "HOLD";

  const reasons: string[] = ["MT5 EA signal", `Volume: ${mt5.volume} lots`];
  if (mt5.comment) reasons.push(mt5.comment);

  const riskReward = calcRiskReward(mt5.price, mt5.stopLoss, mt5.takeProfit);

  const converted: GeneratedSignal = {
    symbol: mt5.symbol,
    market,
    timeframe: "1h",
    timestamp: new Date(mt5.timestamp),
    signal: signalDir,
    confidence: 85,
    probability: {
      buy: signalDir === "BUY" ? 85 : signalDir === "SELL" ? 10 : 30,
      sell: signalDir === "SELL" ? 85 : signalDir === "BUY" ? 10 : 30,
      hold: signalDir === "HOLD" ? 85 : 5,
    },
    technicalScore: 80,
    aiScore: 75,
    sentimentScore: 70,
    riskScore: 30,
    entryPrice: mt5.price,
    stopLoss: mt5.stopLoss,
    takeProfit: mt5.takeProfit,
    riskReward,
    reasons,
    passedRiskCheck: true,
  };

  return converted;
}

// Validate and receive an incoming MT5 signal
export async function receiveMT5Signal(
  payload: MT5Signal,
  webhookSecret: string
): Promise<MT5SignalResult> {
  const expectedSecret = process.env.MT5_WEBHOOK_SECRET;

  // Validate secret
  if (!expectedSecret || webhookSecret !== expectedSecret) {
    const result: MT5SignalResult = {
      id: generateId(),
      received: new Date(),
      signal: payload,
      converted: null,
      status: "rejected",
      reason: "Invalid or missing webhook secret",
    };
    pushSignal(result);
    return result;
  }

  const converted = convertToGeneratedSignal(payload);

  const result: MT5SignalResult = {
    id: generateId(),
    received: new Date(),
    signal: payload,
    converted,
    status: "processed",
  };

  pushSignal(result);
  return result;
}

// Push to circular buffer
function pushSignal(result: MT5SignalResult): void {
  signalStore.unshift(result); // newest first
  if (signalStore.length > MAX_SIGNALS) {
    signalStore.splice(MAX_SIGNALS); // trim to max
  }
}

// Return stored signals newest first
export function getMT5Signals(): MT5SignalResult[] {
  return [...signalStore];
}

// Clear signal history
export function clearMT5Signals(): void {
  signalStore.splice(0, signalStore.length);
}
