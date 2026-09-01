import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  interval: "monthly" | "yearly";
  features: string[];
  limits: {
    signalsPerDay: number;
    markets: number;
    backtestsPerDay: number;
    aiAssistant: boolean;
    telegramAlerts: boolean;
    emailAlerts: boolean;
    portfolioTracking: boolean;
    advancedIndicators: boolean;
  };
}

const PLANS: Record<string, SubscriptionPlan> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    interval: "monthly",
    features: [
      "5 AI signals per day",
      "Crypto market only",
      "Basic indicators",
      "Email alerts",
      "7-day signal history",
    ],
    limits: {
      signalsPerDay: 5,
      markets: 1, // crypto only
      backtestsPerDay: 1,
      aiAssistant: false,
      telegramAlerts: false,
      emailAlerts: true,
      portfolioTracking: false,
      advancedIndicators: false,
    },
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 19,
    interval: "monthly",
    features: [
      "50 AI signals per day",
      "Crypto + Forex",
      "All indicators",
      "Email + Telegram alerts",
      "30-day signal history",
      "Basic backtesting",
      "Portfolio tracking",
    ],
    limits: {
      signalsPerDay: 50,
      markets: 2, // crypto + forex
      backtestsPerDay: 10,
      aiAssistant: false,
      telegramAlerts: true,
      emailAlerts: true,
      portfolioTracking: true,
      advancedIndicators: false,
    },
  },
  professional: {
    id: "professional",
    name: "Professional",
    price: 49,
    interval: "monthly",
    features: [
      "Unlimited AI signals",
      "All markets (Crypto, Forex, Stocks, Commodities)",
      "Advanced indicators + AI explanations",
      "Email + Telegram alerts",
      "Unlimited signal history",
      "Advanced backtesting",
      "AI Trading Assistant",
      "Priority support",
    ],
    limits: {
      signalsPerDay: 999999,
      markets: 4, // all markets
      backtestsPerDay: 100,
      aiAssistant: true,
      telegramAlerts: true,
      emailAlerts: true,
      portfolioTracking: true,
      advancedIndicators: true,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 149,
    interval: "monthly",
    features: [
      "Everything in Professional",
      "API access",
      "Custom AI models",
      "White-label options",
      "Dedicated support",
      "Team accounts (up to 10)",
      "Advanced analytics",
    ],
    limits: {
      signalsPerDay: 999999,
      markets: 4,
      backtestsPerDay: 999999,
      aiAssistant: true,
      telegramAlerts: true,
      emailAlerts: true,
      portfolioTracking: true,
      advancedIndicators: true,
    },
  },
};

// Trial period: 30 days
const TRIAL_DAYS = 30;

export const subscriptionsRouter = createRouter({
  // Get all available plans
  plans: publicQuery.query(() => {
    return Object.values(PLANS);
  }),

  // Get user's current subscription
  current: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .query(({ input: _input }) => {
      // In production, query from database
      // For now, return trial subscription
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

      return {
        plan: "professional", // Full access during trial
        status: "trial",
        trialEndsAt: trialEndDate.toISOString(),
        daysRemaining: TRIAL_DAYS,
        features: PLANS.professional.features,
        limits: PLANS.professional.limits,
        isTrial: true,
        canUpgrade: true,
      };
    }),

  // Check if user can perform an action
  checkLimit: publicQuery
    .input(
      z.object({
        userId: z.string().default("default"),
        action: z.enum([
          "signal",
          "backtest",
          "ai_assistant",
          "telegram_alert",
          "advanced_indicator",
        ]),
      })
    )
    .query(({ input: _input }) => {
      // In production, check against actual usage in database
      // During trial, allow everything
      return {
        allowed: true,
        remaining: 999999,
        limit: 999999,
        isTrial: true,
      };
    }),

  // Subscribe to a plan
  subscribe: publicQuery
    .input(
      z.object({
        userId: z.string().default("default"),
        planId: z.enum(["free", "starter", "professional", "enterprise"]),
        paymentMethod: z.string().optional(), // "mpesa", "stripe", "paypal"
      })
    )
    .mutation(({ input }) => {
      const plan = PLANS[input.planId];
      if (!plan) {
        throw new Error("Invalid plan");
      }

      // In production, process payment here
      // For now, return success
      return {
        success: true,
        plan: input.planId,
        status: "active",
        features: plan.features,
        limits: plan.limits,
        message: `Successfully subscribed to ${plan.name} plan`,
      };
    }),

  // Cancel subscription
  cancel: publicQuery
    .input(z.object({ userId: z.string().default("default") }))
    .mutation(() => {
      return {
        success: true,
        status: "cancelled",
        message:
          "Subscription will be cancelled at the end of the billing period",
      };
    }),
});
