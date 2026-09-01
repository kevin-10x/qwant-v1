import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import {
  fetchQuantOHLCV,
  getQuantSymbols,
  quantDisplayName,
  MARKET_IDS,
  TIMEFRAME_IDS,
  type MarketKind,
} from "../services/quant/marketData";
import { STRATEGIES, STRATEGY_LABELS, STRATEGY_IDS, type StrategyId } from "../services/quant/strategies";
import { runBacktest } from "../services/quant/backtest";
import { generateQuantReport } from "../services/quant/report";

export const quantRouter = createRouter({
  // Run a single market-structure + Fibonacci backtest.
  run: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z.enum(MARKET_IDS).default("crypto"),
        timeframe: z.enum(TIMEFRAME_IDS).default("1d"),
        strategy: z.enum(STRATEGY_IDS).default("fib_retrace"),
        initialBalance: z.number().default(10000),
        riskPerTrade: z.number().default(1),
      })
    )
    .query(async ({ input }) => {
      const bars = await fetchQuantOHLCV(
        input.symbol,
        input.market as MarketKind,
        input.timeframe,
        500
      );
      if (bars.length < 60) {
        throw new Error("Insufficient data for quant backtest");
      }
      return runBacktest(bars, STRATEGIES[input.strategy], {
        initialBalance: input.initialBalance,
        riskPerTrade: input.riskPerTrade,
        warmup: 60,
      });
    }),

  // Compare all quant strategies on a symbol/market/timeframe.
  compare: publicQuery
    .input(
      z.object({
        symbol: z.string(),
        market: z.enum(MARKET_IDS).default("crypto"),
        timeframe: z.enum(TIMEFRAME_IDS).default("1d"),
      })
    )
    .query(async ({ input }) => {
      const bars = await fetchQuantOHLCV(
        input.symbol,
        input.market as MarketKind,
        input.timeframe,
        500
      );
      const results = STRATEGY_IDS.map((strategy: StrategyId) => {
        try {
          const res = runBacktest(bars, STRATEGIES[strategy], { warmup: 60 });
          return {
            strategy,
            label: STRATEGY_LABELS[strategy],
            ...res.metrics,
          };
        } catch (e) {
          return {
            strategy,
            label: STRATEGY_LABELS[strategy],
            error: (e as Error).message,
          };
        }
      });
      return results;
    }),

  // Daily quant report across one or all markets.
  report: publicQuery
    .input(
      z.object({
        market: z.enum([...MARKET_IDS, "all"] as const).default("all"),
      })
    )
    .query(async ({ input }) => {
      const markets: MarketKind[] =
        input.market === "all" ? [...MARKET_IDS] : [input.market];
      const reports = [];
      for (const market of markets) {
        for (const rawSymbol of getQuantSymbols(market)) {
          const symbol = quantDisplayName(rawSymbol, market);
          const bars = await fetchQuantOHLCV(rawSymbol, market, "1d", 500);
          reports.push(generateQuantReport(bars, { symbol, market, timeframe: "1d" }));
        }
      }
      return reports;
    }),
});