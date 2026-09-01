import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import {
  sendEmailAlert,
  sendTelegramAlert,
  testNotifications,
  sendTelegramWelcome,
} from "../services/notifications.js";
import { generateSignal } from "../services/signals.js";

export const notificationsRouter = createRouter({
  // Send test email
  testEmail: publicQuery
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const result = await testNotifications(input.email);
      return result;
    }),

  // Send test Telegram
  testTelegram: publicQuery
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const result = await testNotifications(undefined, input.chatId);
      return result;
    }),

  // Send signal alert via email
  sendEmail: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
      })
    )
    .query(async ({ input }) => {
      const signal = await generateSignal(input.symbol, input.market);
      if (!signal) {
        return { success: false, error: "No signal generated" };
      }
      return sendEmailAlert(input.email, signal);
    }),

  // Send signal alert via Telegram
  sendTelegram: publicQuery
    .input(
      z.object({
        chatId: z.string(),
        symbol: z.string(),
        market: z
          .enum(["crypto", "forex", "stocks", "commodities"])
          .default("crypto"),
      })
    )
    .query(async ({ input }) => {
      const signal = await generateSignal(input.symbol, input.market);
      if (!signal) {
        return { success: false, error: "No signal generated" };
      }
      return sendTelegramAlert(input.chatId, signal);
    }),

  // Send Telegram welcome message
  telegramWelcome: publicQuery
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      await sendTelegramWelcome(input.chatId);
      return { success: true };
    }),
});
