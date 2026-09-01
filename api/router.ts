import { authRouter } from "./auth-router.js";
import { createRouter, publicQuery } from "./middleware.js";
import { marketRouter } from "./routers/market.js";
import { signalsRouter } from "./routers/signals.js";
import { aiRouter } from "./routers/ai.js";
import { tradesRouter } from "./routers/trades.js";
import { notificationsRouter } from "./routers/notifications.js";
import { backtestRouter } from "./routers/backtest.js";
import { subscriptionsRouter } from "./routers/subscriptions.js";
import { mt5Router } from "./routers/mt5.js";
import { quantRouter } from "./routers/quant.js";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  market: marketRouter,
  signals: signalsRouter,
  ai: aiRouter,
  trades: tradesRouter,
  notifications: notificationsRouter,
  backtest: backtestRouter,
  subscriptions: subscriptionsRouter,
  mt5: mt5Router,
  quant: quantRouter,
});

export type AppRouter = typeof appRouter;
