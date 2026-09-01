import { fetchMarketData } from "./market-data.js";

export interface PaperPosition {
  id: string;
  symbol: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  profit: number;
  profitPercent: number;
  stopLoss: number;
  takeProfit: number;
  status: "open" | "closed" | "stopped";
  openedAt: Date;
  closedAt?: Date;
}

export interface Portfolio {
  balance: number;
  equity: number;
  totalProfit: number;
  totalProfitPercent: number;
  openPositions: PaperPosition[];
  closedPositions: PaperPosition[];
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

// In-memory portfolio storage (use database in production)
const portfolios: Map<string, Portfolio> = new Map();

function getPortfolio(userId: string): Portfolio {
  if (!portfolios.has(userId)) {
    portfolios.set(userId, {
      balance: 10000,
      equity: 10000,
      totalProfit: 0,
      totalProfitPercent: 0,
      openPositions: [],
      closedPositions: [],
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
    });
  }
  return portfolios.get(userId)!;
}

function savePortfolio(userId: string, portfolio: Portfolio): void {
  portfolios.set(userId, portfolio);
}

// Open a paper trade
export function openPaperTrade(
  userId: string,
  symbol: string,
  signal: "BUY" | "SELL",
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  riskPercent: number = 2
): PaperPosition | null {
  const portfolio = getPortfolio(userId);

  // Calculate position size based on risk
  const riskAmount = portfolio.balance * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance === 0) return null;

  const quantity = riskAmount / stopDistance;
  const positionValue = quantity * entryPrice;

  // Check if we have enough balance
  if (positionValue > portfolio.equity * 0.9) {
    // Limit to 90% of equity
    return null;
  }

  const position: PaperPosition = {
    id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    type: signal === "BUY" ? "LONG" : "SHORT",
    entryPrice,
    currentPrice: entryPrice,
    quantity,
    profit: 0,
    profitPercent: 0,
    stopLoss,
    takeProfit,
    status: "open",
    openedAt: new Date(),
  };

  portfolio.openPositions.push(position);
  portfolio.totalTrades++;

  savePortfolio(userId, portfolio);
  return position;
}

// Close a paper trade
export function closePaperTrade(
  userId: string,
  positionId: string,
  exitPrice: number
): PaperPosition | null {
  const portfolio = getPortfolio(userId);
  const positionIndex = portfolio.openPositions.findIndex(
    (p) => p.id === positionId
  );

  if (positionIndex === -1) return null;

  const position = portfolio.openPositions[positionIndex];

  // Calculate profit
  if (position.type === "LONG") {
    position.profit = (exitPrice - position.entryPrice) * position.quantity;
  } else {
    position.profit = (position.entryPrice - exitPrice) * position.quantity;
  }

  position.profitPercent =
    (position.profit / (position.entryPrice * position.quantity)) * 100;
  position.currentPrice = exitPrice;
  position.status = "closed";
  position.closedAt = new Date();

  // Update portfolio
  portfolio.balance += position.profit;
  portfolio.totalProfit += position.profit;
  portfolio.totalProfitPercent =
    (portfolio.totalProfit / 10000) * 100; // Based on initial $10k

  if (position.profit > 0) {
    portfolio.winningTrades++;
  } else {
    portfolio.losingTrades++;
  }

  portfolio.winRate =
    portfolio.totalTrades > 0
      ? (portfolio.winningTrades / portfolio.totalTrades) * 100
      : 0;

  // Move to closed positions
  portfolio.closedPositions.push(position);
  portfolio.openPositions.splice(positionIndex, 1);

  // Update equity
  portfolio.equity = portfolio.balance + getOpenPositionsValue(portfolio);

  savePortfolio(userId, portfolio);
  return position;
}

// Update open positions with current prices
export async function updatePositions(userId: string): Promise<Portfolio> {
  const portfolio = getPortfolio(userId);

  for (const position of portfolio.openPositions) {
    if (position.status !== "open") continue;

    try {
      // Fetch current price
      const data = await fetchMarketData(position.symbol, "crypto", "1h", 1);
      const currentPrice = data[data.length - 1].close;
      position.currentPrice = currentPrice;

      // Calculate unrealized P&L
      if (position.type === "LONG") {
        position.profit =
          (currentPrice - position.entryPrice) * position.quantity;
      } else {
        position.profit =
          (position.entryPrice - currentPrice) * position.quantity;
      }

      position.profitPercent =
        (position.profit / (position.entryPrice * position.quantity)) * 100;

      // Check stop loss and take profit
      if (position.type === "LONG") {
        if (currentPrice <= position.stopLoss) {
          position.status = "stopped";
        } else if (currentPrice >= position.takeProfit) {
          position.status = "stopped";
        }
      } else {
        if (currentPrice >= position.stopLoss) {
          position.status = "stopped";
        } else if (currentPrice <= position.takeProfit) {
          position.status = "stopped";
        }
      }
    } catch (error) {
      console.error(`Error updating position ${position.id}:`, error);
    }
  }

  // Update equity
  portfolio.equity = portfolio.balance + getOpenPositionsValue(portfolio);

  savePortfolio(userId, portfolio);
  return portfolio;
}

function getOpenPositionsValue(portfolio: Portfolio): number {
  return portfolio.openPositions.reduce((sum, pos) => {
    if (pos.type === "LONG") {
      return sum + (pos.currentPrice - pos.entryPrice) * pos.quantity;
    } else {
      return sum + (pos.entryPrice - pos.currentPrice) * pos.quantity;
    }
  }, 0);
}

// Get portfolio summary
export async function getPortfolioSummary(userId: string): Promise<Portfolio> {
  return updatePositions(userId);
}

// Reset portfolio
export function resetPortfolio(userId: string): void {
  portfolios.delete(userId);
}

// Get trade history
export function getTradeHistory(userId: string): PaperPosition[] {
  const portfolio = getPortfolio(userId);
  return [...portfolio.closedPositions].sort(
    (a, b) =>
      (b.closedAt?.getTime() || 0) - (a.closedAt?.getTime() || 0)
  );
}
