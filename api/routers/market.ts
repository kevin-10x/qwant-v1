import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import {
  fetchMarketData,
  getCurrentPrice,
  SUPPORTED_SYMBOLS,
} from "../services/market-data.js";
import { calculateIndicators } from "../services/indicators.js";

export const marketRouter = createRouter({
  // Get supported symbols
  symbols: publicQuery.query(() => {
    return SUPPORTED_SYMBOLS;
  }),

  // Get current price for a symbol
  price: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
      })
    )
    .query(async ({ input }) => {
      const price = await getCurrentPrice(input.symbol, input.market);
      return price;
    }),

  // Get historical OHLCV data
  candles: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
        timeframe: z.string().default("1h"),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const data = await fetchMarketData(
        input.symbol,
        input.market,
        input.timeframe,
        input.limit
      );
      return data;
    }),

  // Get technical indicators
  indicators: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
        timeframe: z.string().default("1h"),
      })
    )
    .query(async ({ input }) => {
      const data = await fetchMarketData(
        input.symbol,
        input.market,
        input.timeframe,
        100
      );
      const indicators = calculateIndicators(data);
      return indicators;
    }),
});
