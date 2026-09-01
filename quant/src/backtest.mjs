// backtest.mjs — event-driven backtester with trade accounting and performance metrics.
//
// No-lookahead execution model:
//   - At bar i the strategy is evaluated using data up to and including bar i.
//   - If a signal is produced it becomes a PENDING order, filled at the OPEN of
//     bar i+1 (with slippage applied to the open).
//   - The open position is managed bar by bar; SL/TP are checked intrabar. When the
//     bar's range hits both SL and TP, the one closest to the open triggers first.
//
// Position sizing: risk a fixed % of equity per trade, driven by the SL distance.

export function runBacktest(bars, strategyFn, opts = {}) {
  const initialBalance = opts.initialBalance ?? 10000;
  const riskPerTrade = (opts.riskPerTrade ?? 1) / 100;
  const commissionPct = opts.commissionPct ?? 0.001; // 0.1% per side
  const slippagePct = opts.slippagePct ?? 0.001;

  let equity = initialBalance;
  const trades = [];
  const equityCurve = [{ date: bars[0].timestamp, equity }];

  const warmup = opts.warmup ?? 60;

  let pending = null; // order to fill at next open
  let position = null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // ---------- 1) Fill pending order at this bar's OPEN ----------
    if (pending) {
      const slip = pending.type === "LONG" ? 1 + slippagePct : 1 - slippagePct;
      const entryPrice = bar.open * slip;
      const slDist = Math.abs(entryPrice - pending.sl);
      const risk0 = slDist > 0 ? slDist : entryPrice * 0.01;
      const riskAmt = equity * riskPerTrade;
      // Clamp so a tiny SL doesn't blow up position size (max 5x base leverage).
      const sizeUnits = Math.min(riskAmt / risk0, Math.max((equity / entryPrice) * 5, 0));
      // A gap through the levels invalidates the setup: close at the fill price.
      const gapBreached =
        pending.type === "LONG"
          ? entryPrice <= pending.sl || entryPrice >= pending.tp
          : entryPrice >= pending.sl || entryPrice <= pending.tp;
      if (gapBreached) {
        const commission = entryPrice * sizeUnits * commissionPct * 2;
        equity -= commission;
        trades.push({
          type: pending.type,
          entryIndex: pending.entryIndex,
          exitIndex: i,
          entryPrice,
          exitPrice: entryPrice,
          reason: pending.reason,
          exitReason: "gap",
          pnl: -commission,
          pnlPct: (-commission / initialBalance) * 100,
          rMultiple: 0,
        });
        equityCurve.push({ date: bar.timestamp, equity });
        pending = null;
      } else {
        position = {
          type: pending.type,
          entryPrice,
          sl: pending.sl,
          tp: pending.tp,
          sizeUnits,
          riskUnits: riskAmt,
          entryIndex: pending.entryIndex,
          reason: pending.reason,
        };
        pending = null;
      }
    }

    // ---------- 2) Manage open position ----------
    if (position) {
      const entry = position.entryPrice;
      const barHigh = Math.max(bar.open, bar.high);
      const barLow = Math.min(bar.open, bar.low);
      const hitSL = position.type === "LONG" ? barLow <= position.sl : barHigh >= position.sl;
      const hitTP = position.type === "LONG" ? barHigh >= position.tp : barLow <= position.tp;

      let exitPrice = null, exitReason = null;
      if (hitSL && hitTP) {
        // Whichever is closer to the open triggers first.
        const dSL = Math.abs(bar.open - position.sl);
        const dTP = Math.abs(bar.open - position.tp);
        if (dSL <= dTP) { exitPrice = position.sl; exitReason = "sl"; }
        else { exitPrice = position.tp; exitReason = "tp"; }
      } else if (hitSL) {
        exitPrice = position.sl; exitReason = "sl";
      } else if (hitTP) {
        exitPrice = position.tp; exitReason = "tp";
      }

      if (exitPrice != null) {
        const gross =
          (position.type === "LONG" ? exitPrice - entry : entry - exitPrice) * position.sizeUnits;
        const commission =
          entry * position.sizeUnits * commissionPct + exitPrice * position.sizeUnits * commissionPct;
        const pnl = gross - commission;
        equity += pnl;
        trades.push({
          type: position.type,
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryPrice: entry,
          exitPrice,
          reason: position.reason,
          exitReason,
          pnl,
          pnlPct: (pnl / initialBalance) * 100,
          rMultiple: position.riskUnits > 0 ? pnl / position.riskUnits : 0,
        });
        position = null;
        equityCurve.push({ date: bar.timestamp, equity });
        // Fall through to allow opening a new position after a close this bar.
      } else {
        // Mark to market (unrealized) for the equity curve.
        const unreal =
          (position.type === "LONG" ? bar.close - entry : entry - bar.close) * position.sizeUnits;
        equityCurve.push({ date: bar.timestamp, equity: equity + unreal });
        continue; // already in a position; can't open another
      }
    }

    // ---------- 3) Evaluate for a new pending order ----------
    if (i >= warmup && i + 1 < bars.length) {
      const decision = strategyFn(bars, i);
      if (decision) {
        pending = { type: decision.type, sl: decision.sl, tp: decision.tp, reason: decision.reason };
        // flat mark
        equityCurve.push({ date: bar.timestamp, equity });
        continue;
      }
    }

    // no position, no pending trade -> flat
    equityCurve.push({ date: bar.timestamp, equity });
  }

  // Force-close any still-open position at the final bar.
  if (position) {
    const last = bars[bars.length - 1];
    const gross =
      (position.type === "LONG" ? last.close - position.entryPrice : position.entryPrice - last.close) *
      position.sizeUnits;
    const commission =
      position.entryPrice * position.sizeUnits * commissionPct +
      last.close * position.sizeUnits * commissionPct;
    const pnl = gross - commission;
    equity += pnl;
    trades.push({
      type: position.type,
      entryIndex: position.entryIndex,
      exitIndex: bars.length - 1,
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      reason: position.reason,
      exitReason: "eod",
      pnl,
      pnlPct: (pnl / initialBalance) * 100,
      rMultiple: position.riskUnits > 0 ? pnl / position.riskUnits : 0,
    });
    equityCurve[equityCurve.length - 1] = { date: last.timestamp, equity };
  }

  return computeMetrics({ bars, trades, equityCurve, initialBalance, finalEquity: equity });
}

function computeMetrics({ bars, trades, equityCurve, initialBalance, finalEquity }) {
  const periodReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) periodReturns.push((equityCurve[i].equity - prev) / prev);
  }

  const mean = periodReturns.length ? periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length : 0;
  const variance = periodReturns.length
    ? periodReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / periodReturns.length
    : 0;
  const std = Math.sqrt(variance);
  const annualization = Math.sqrt(bars.length || 1);
  const sharpe = std > 0 ? (mean / std) * annualization : 0;

  let peak = -Infinity;
  let maxDDAbs = 0;
  let maxDDPct = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDDAbs) maxDDAbs = dd;
    if (peak > 0) {
      const ddPct = (dd / peak) * 100;
      if (ddPct > maxDDPct) maxDDPct = ddPct;
    }
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const years = Math.max((bars[bars.length - 1].timestamp - bars[0].timestamp) / (365.25 * 86400000), 1 / 365);
  const totalReturnPct = ((finalEquity - initialBalance) / initialBalance) * 100;
  const cagrPct = (Math.pow(finalEquity / initialBalance, 1 / years) - 1) * 100;

  return {
    trades,
    equityCurve,
    metrics: {
      initialBalance,
      finalEquity,
      period: labelPeriod(bars),
      totalReturnPct,
      cagrPct,
      years,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor,
      sharpe,
      maxDrawdownAbs: maxDDAbs,
      maxDrawdownPct: maxDDPct,
      avgRMultiple: trades.length ? trades.reduce((a, b) => a + b.rMultiple, 0) / trades.length : 0,
    },
  };
}

function labelPeriod(bars) {
  if (!bars.length) return "";
  const f = (d) => d.toISOString().slice(0, 10);
  return `${f(bars[0].timestamp)} : ${f(bars[bars.length - 1].timestamp)}`;
}
