import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { marketRouter } from "./routers/market";
import { signalsRouter } from "./routers/signals";
import { aiRouter } from "./routers/ai";
import { tradesRouter } from "./routers/trades";
import { notificationsRouter } from "./routers/notifications";
import { backtestRouter } from "./routers/backtest";
import { subscriptionsRouter } from "./routers/subscriptions";
import { mt5Router } from "./routers/mt5";
import { quantRouter } from "./routers/quant";

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
