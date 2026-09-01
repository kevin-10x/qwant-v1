import axios from "axios";
import type { OHLCV } from "./market-data.js";
import type { IndicatorValues } from "./indicators.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant"; // Free tier model
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface LLMSentimentResult {
  sentimentScore: number; // 0-100 (bearish to bullish)
  confidence: number; // 0-100
  reasoning: string;
  riskNotes: string[];
  marketRegime: "trending" | "ranging" | "volatile" | "calm";
  keyLevels: { type: "support" | "resistance"; price: number }[];
}

interface CacheEntry {
  data: LLMSentimentResult;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

function getCached(key: string): LLMSentimentResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: LLMSentimentResult): void {
  // Limit cache size
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

function formatCandles(candles: OHLCV[]): string {
  const recent = candles.slice(-20);
  return recent
    .map(
      (c) =>
        `O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${Math.round(c.volume)}`
    )
    .join("\n");
}

function formatIndicators(indicators: IndicatorValues): string {
  const parts: string[] = [];
  if (indicators.rsi14 !== null) parts.push(`RSI(14): ${indicators.rsi14.toFixed(1)}`);
  if (indicators.macd !== null) parts.push(`MACD: ${indicators.macd.toFixed(4)}`);
  if (indicators.macdHistogram !== null) parts.push(`MACD Hist: ${indicators.macdHistogram.toFixed(4)}`);
  if (indicators.ema20 !== null) parts.push(`EMA20: ${indicators.ema20.toFixed(2)}`);
  if (indicators.ema50 !== null) parts.push(`EMA50: ${indicators.ema50.toFixed(2)}`);
  if (indicators.bbUpper !== null) parts.push(`BB Upper: ${indicators.bbUpper.toFixed(2)}`);
  if (indicators.bbLower !== null) parts.push(`BB Lower: ${indicators.bbLower.toFixed(2)}`);
  if (indicators.atr14 !== null) parts.push(`ATR(14): ${indicators.atr14.toFixed(4)}`);
  if (indicators.vwap !== null) parts.push(`VWAP: ${indicators.vwap.toFixed(2)}`);
  parts.push(`Trend: ${indicators.trend}`);
  if (indicators.support !== null) parts.push(`Support: ${indicators.support.toFixed(2)}`);
  if (indicators.resistance !== null) parts.push(`Resistance: ${indicators.resistance.toFixed(2)}`);
  return parts.join(", ");
}

export async function getLLMSentiment(
  symbol: string,
  timeframe: string,
  candles: OHLCV[],
  indicators: IndicatorValues
): Promise<LLMSentimentResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const cacheKey = getCacheKey(symbol, timeframe);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const lastCandle = candles[candles.length - 1];
  const priceChange5 = candles.length >= 6
    ? ((lastCandle.close - candles[candles.length - 6].close) / candles[candles.length - 6].close * 100).toFixed(2)
    : "N/A";
  const priceChange20 = candles.length >= 21
    ? ((lastCandle.close - candles[candles.length - 21].close) / candles[candles.length - 21].close * 100).toFixed(2)
    : "N/A";

  const systemPrompt = `You are a quantitative trading analyst. Analyze the provided market data and technical indicators for ${symbol} on the ${timeframe} timeframe.

Current price: ${lastCandle.close.toFixed(2)}
Recent price change (5 candles): ${priceChange5}%
Recent price change (20 candles): ${priceChange20}%

Recent OHLCV candles (oldest to newest):
${formatCandles(candles)}

Technical indicators:
${formatIndicators(indicators)}

Respond with ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "sentimentScore": <number 0-100, where 0=extremely bearish, 50=neutral, 100=extremely bullish>,
  "confidence": <number 0-100, how confident you are in this assessment>,
  "reasoning": "<1-2 sentence explanation of your sentiment assessment>",
  "riskNotes": ["<risk factor 1>", "<risk factor 2>"],
  "marketRegime": "<trending|ranging|volatile|calm>",
  "keyLevels": [{"type": "support", "price": <number>}, {"type": "resistance", "price": <number>}]
}

Be data-driven. Base your analysis purely on the technical data provided. Do not fabricate information.`;

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Analyze this market data and provide your sentiment assessment." },
        ],
        temperature: 0.3,
        max_tokens: 512,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const content = response.data.choices[0]?.message?.content;
    if (!content) return null;

    // Parse JSON from response, stripping potential markdown wrappers
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as LLMSentimentResult;

    // Validate and clamp values
    const result: LLMSentimentResult = {
      sentimentScore: Math.max(0, Math.min(100, parsed.sentimentScore || 50)),
      confidence: Math.max(0, Math.min(100, parsed.confidence || 50)),
      reasoning: parsed.reasoning || "Analysis unavailable",
      riskNotes: Array.isArray(parsed.riskNotes) ? parsed.riskNotes.slice(0, 5) : [],
      marketRegime: ["trending", "ranging", "volatile", "calm"].includes(parsed.marketRegime)
        ? parsed.marketRegime
        : "ranging",
      keyLevels: Array.isArray(parsed.keyLevels) ? parsed.keyLevels.slice(0, 4) : [],
    };

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Groq LLM sentiment error:", error);
    return null;
  }
}
