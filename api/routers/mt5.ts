import type { Hono } from "hono";
import { createRouter, publicQuery } from "../middleware.js";
import {
  receiveMT5Signal,
  getMT5Signals,
  clearMT5Signals,
  type MT5Signal,
} from "../services/mt5.js";

// tRPC router for MT5-related queries/mutations
export const mt5Router = createRouter({
  // Get received MT5 signals (newest first)
  signals: publicQuery.query(() => getMT5Signals()),

  // Clear signal history
  clear: publicQuery.mutation(() => {
    clearMT5Signals();
    return { ok: true };
  }),

  // Get webhook setup info
  info: publicQuery.query(() => ({
    webhookUrl: "/api/mt5/webhook",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MT5-Secret": "<your MT5_WEBHOOK_SECRET>",
    },
    note: "Set MT5_WEBHOOK_SECRET in your .env file",
  })),
});

// Register the raw Hono webhook endpoint (outside tRPC)
export function registerMT5Webhook(app: Hono<any>): void {
  app.post("/api/mt5/webhook", async (c) => {
    try {
      const secret = c.req.header("X-MT5-Secret") ?? "";

      let body: MT5Signal;
      try {
        body = await c.req.json<MT5Signal>();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      // Basic shape validation
      if (
        !body.symbol ||
        !body.action ||
        typeof body.price !== "number" ||
        typeof body.stopLoss !== "number" ||
        typeof body.takeProfit !== "number" ||
        typeof body.volume !== "number" ||
        typeof body.magic !== "number" ||
        !body.timestamp
      ) {
        return c.json({ error: "Missing required fields in payload" }, 400);
      }

      const result = await receiveMT5Signal(body, secret);

      if (result.status === "rejected") {
        return c.json({ error: result.reason ?? "Rejected" }, 401);
      }

      return c.json(result, 200);
    } catch (err) {
      console.error("MT5 webhook error:", err);
      return c.json({ error: "Internal server error" }, 500);
    }
  });
}
