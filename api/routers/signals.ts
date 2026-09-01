import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import {
  generateSignal,
  scanMarkets,
  getMarketScanner,
} from "../services/signals.js";
import { SUPPORTED_SYMBOLS } from "../services/market-data.js";

export const signalsRouter = createRouter({
  // Generate signal for a single symbol
  generate: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
        timeframe: z.string().default("1h"),
        minConfidence: z.number().min(0).max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      const signal = await generateSignal(
        input.symbol,
        input.market,
        input.timeframe,
        input.minConfidence ? { minConfidence: input.minConfidence } : undefined
      );
      return signal;
    }),

  // Scan all supported markets for signals
  scan: publicQuery
    .input(
      z.object({
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
        minConfidence: z.number().min(0).max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      const symbols = SUPPORTED_SYMBOLS[input.market].map((symbol) => ({
        symbol,
        market: input.market,
      }));

      const signals = await scanMarkets(
        symbols,
        input.minConfidence ? { minConfidence: input.minConfidence } : undefined
      );
      return signals;
    }),

  // Start market scanner
  startScanner: publicQuery
    .input(
      z.object({
        symbols: z
          .array(
            z.object({
              symbol: z.string(),
              market: z.enum(["crypto", "forex", "stocks", "commodities"]),
            })
          )
          .optional(),
        interval: z.number().default(30000),
      })
    )
    .mutation(({ input }) => {
      const scanner = getMarketScanner();
      const symbols =
        input.symbols ||
        SUPPORTED_SYMBOLS.crypto.map((s) => ({ symbol: s, market: "crypto" as const }));

      scanner.start(symbols, input.interval);
      return { status: "started", symbols: symbols.length };
    }),

  // Stop market scanner
  stopScanner: publicQuery.mutation(() => {
    const scanner = getMarketScanner();
    scanner.stop();
    return { status: "stopped" };
  }),

  // Scanner status
  scannerStatus: publicQuery.query(() => {
    const scanner = getMarketScanner();
    return { active: scanner.isActive() };
  }),
});
