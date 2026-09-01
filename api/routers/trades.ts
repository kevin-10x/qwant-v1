import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import {
  openPaperTrade,
  closePaperTrade,
  getPortfolioSummary,
  getTradeHistory,
  resetPortfolio,
  updatePositions,
} from "../services/paper-trading.js";

export const tradesRouter = createRouter({
  // Get portfolio summary
  portfolio: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .query(async ({ input }) => {
      const portfolio = await getPortfolioSummary(input.userId);
      return portfolio;
    }),

  // Open a paper trade
  open: publicQuery
    .input(
      z.object({
        userId: z.string().default("default"),
        symbol: z.string(),
        signal: z.enum(["BUY", "SELL"]),
        entryPrice: z.number(),
        stopLoss: z.number(),
        takeProfit: z.number(),
        riskPercent: z.number().default(2),
      })
    )
    .mutation(({ input }) => {
      const position = openPaperTrade(
        input.userId,
        input.symbol,
        input.signal,
        input.entryPrice,
        input.stopLoss,
        input.takeProfit,
        input.riskPercent
      );
      return position;
    }),

  // Close a paper trade
  close: publicQuery
    .input(
      z.object({
        userId: z.string().default("default"),
        positionId: z.string(),
        exitPrice: z.number(),
      })
    )
    .mutation(({ input }) => {
      const position = closePaperTrade(
        input.userId,
        input.positionId,
        input.exitPrice
      );
      return position;
    }),

  // Get trade history
  history: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .query(({ input }) => {
      return getTradeHistory(input.userId);
    }),

  // Update positions
  update: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .query(async ({ input }) => {
      return updatePositions(input.userId);
    }),

  // Reset portfolio
  reset: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .mutation(({ input }) => {
      resetPortfolio(input.userId);
      return { status: "reset" };
    }),
});
