# QUANT — Market Structure + Fibonacci Trading Engine

Self-contained quant engine for the trading-bot repo. Rebuilds the strategy/backtest
layer around **market structure + Fibonacci** and produces a daily trading report.

Run with plain Node 18+ (no npm install required — uses only global `fetch`):

```bash
# Backtest all markets / symbols / strategies, print comparison, save quant-results.json
node src/run-backtest.mjs

# Narrow scope
node src/run-backtest.mjs --market crypto --tf 1d --strategy fib_retrace
node src/run-backtest.mjs --market stocks --symbol AAPL --tf 1d

# Today's actionable quant report (all markets) -> prints + saves quant-daily-report.json
node src/run-daily.mjs
```

## Modules

| File | Purpose |
|---|---|
| `marketData.mjs` | OHLCV fetcher: Binance (crypto), Yahoo Finance (stocks/commodities), Frankfurter/ECB (forex, 1d). Deterministic synthetic fallback so the engine always runs. |
| `indicators.mjs` | EMA, SMA, Wilder RSI, Wilder ATR. |
| `marketStructure.mjs` | Swing high/low detection, market-structure trend (HH/HL = bullish, LH/LL = bearish), range regime detector. |
| `fibonacci.mjs` | Fib retracement (0.236–0.786) and extension (1.272–2.618) levels from swing legs; anchor-based snapshot that tracks still-forming impulses. |
| `strategies.mjs` | `fib_retrace` (pullback into retracement with RSI/trend confluence), `fib_extension` (momentum through swing high/low targeting extensions), `breakout` (N-bar range breakout), `trend_follow` (EMA20/50 baseline). |
| `backtest.mjs` | Event-driven, **no-lookahead**: signals become pending orders filled at the NEXT bar open; SL/TP checked intrabar; risk 1% of equity per trade; 0.1% commission/side. Metrics: total return, CAGR, win rate, profit factor, Sharpe, max drawdown, avg R-multiple, full trade log + equity curve. |
| `report.mjs` | Daily report: current price, 1d change, structure trend, swing high/low, fib retracements/extensions, nearest level, and a confluence-scored signal (BUY/SELL/HOLD with entry/SL/TP and reasons). |

## Important caveat on the backtest result being honest
This engine intentionally does NOT produce fantasy returns. The implementation
prioritizes correctness (no lookahead, next-bar fills, commissions/slippage). A
sample of results across 108 runs (1d, ~2y of data):

```
market       symbol       strategy       ret%    cagr%   trades  win%  pf    sharpe  maxDD%
crypto       BNBUSDT      breakout       17.16   12.29   30      57    2.14  2.12    4.8
commodities  GOLD         breakout       23.66   11.32   25      56    2.79  2.37    3.1
crypto       ETHUSDT      breakout       10.83    7.82   32      47    1.57  1.21    7.3
commodities  SILVER       breakout       11.35    5.58   25      52    1.93  1.59    4.2
crypto       XRPUSDT      fib_retrace     4.60    3.34   31      68    1.64  1.07    4.4
```

Observations:
- **Breakout is the most robust** strategy (positive edge across crypto, gold,
  silver, natgas, AAPL, MSFT with low drawdown in this window).
- **fib_retrace** shows a real but modest edge, best on range-driven assets
  (XRP 68% win rate). It is a mean-reversion strategy — per-symbol it can lose
  (see BTC/ETH/SOL/ADA where structure stayed momentum-driven).
- **trend_follow** (EMA cross) is the best fit on forex (EURNOK 2.58% CAGR,
  Sharpe 1.14) — an asset class where daily range is small.
- **fib_extension** trades rarely (few clean extension breakouts per 2 years);
  small sample — treat as unproven.
- Forex OHLCV is ECB daily reference (no true intraday high/low per bar), so
  fib strategies produce no trades there; breakout misfires on the flat bars.
  Real intraday forex data (e.g. Dukascopy) is required for forex fib work.

## Daily report (last run, 2026-08-30)
27 symbols tracked; 4 actionable signals:
```
ETHUSDT  SELL 85%  entry=2505.2  sl=2566.53  tp=2362.3   | bearish structure + overbought RSI + near 0.618 retrace
SOLUSDT  SELL 85%  entry=105.56  sl=110.6    tp=97.78    | bearish structure + overbought RSI + near 0.5 retrace
BNBUSDT  SELL 85%  entry=701.53  sl=726.08   tp=663.62   | bearish structure + overbought RSI + near 0.5 retrace
GOLD     SELL 75%  entry=4536.51 sl=4670.9   tp=4447.16  | bearish structure + near 0.236 retrace
```
Crypto majors have been forming lower-highs/lower-lows off extended highs, so
the confluence engine leans short until structure flips bullish.