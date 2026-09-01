import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import { runBacktest, type BacktestConfig } from "../services/backtest.js";

export const backtestRouter = createRouter({
  // Run backtest
  run: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
        timeframe: z.string().default("1h"),
        initialBalance: z.number().default(10000),
        riskPerTrade: z.number().default(2),
        strategy: z
          .enum(["ai", "rsi", "macd", "ema_cross"])
          .default("ai"),
        minConfidence: z.number().default(80),
      })
    )
    .query(async ({ input }) => {
      const config: BacktestConfig = {
        symbol: input.symbol,
        market: input.market,
        timeframe: input.timeframe,
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        initialBalance: input.initialBalance,
        riskPerTrade: input.riskPerTrade,
        strategy: input.strategy,
        minConfidence: input.minConfidence,
      };

      const result = await runBacktest(config);
      return result;
    }),

  // Compare strategies
  compare: publicQuery
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
      const strategies = ["ai", "rsi", "macd", "ema_cross"] as const;
      const results = await Promise.all(
        strategies.map(async (strategy) => {
          const config: BacktestConfig = {
            symbol: input.symbol,
            market: input.market,
            timeframe: input.timeframe,
            startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            endDate: new Date(),
            initialBalance: 10000,
            riskPerTrade: 2,
            strategy,
          };

          try {
            const result = await runBacktest(config);
            return {
              strategy,
              totalReturn: result.totalReturn,
              winRate: result.winRate,
              totalTrades: result.totalTrades,
              sharpeRatio: result.sharpeRatio,
              maxDrawdownPercent: result.maxDrawdownPercent,
              profitFactor: result.profitFactor,
            };
          } catch (error) {
            return {
              strategy,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );

      return results;
    }),
});
