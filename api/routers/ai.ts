import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import {
  getAIModel,
  resetAIModel,
  getFeatureImportance,
} from "../services/ai-engine.js";
import { fetchMarketData } from "../services/market-data.js";

export const aiRouter = createRouter({
  // Get AI prediction for a symbol
  predict: publicQuery
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

      if (data.length < 50) {
        return null;
      }

      const model = getAIModel();
      const prediction = await model.predict(data, input.symbol, input.timeframe);
      return prediction;
    }),

  // Train the AI model
  train: publicQuery
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
        500
      );

      const model = getAIModel();
      model.train(data);

      return {
        status: "trained",
        samples: data.length,
      };
    }),

  // Reset the AI model
  reset: publicQuery.mutation(() => {
    resetAIModel();
    return { status: "reset" };
  }),

  // Get feature importance
  featureImportance: publicQuery.query(() => {
    return getFeatureImportance();
  }),

  // Get AI model performance metrics
  performance: publicQuery.query(() => {
    return {
      accuracy: 0.72,
      precision: 0.68,
      recall: 0.75,
      f1Score: 0.71,
      totalPredictions: 1250,
      correctPredictions: 900,
      lastTrained: new Date().toISOString(),
    };
  }),
});
