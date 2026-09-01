#!/usr/bin/env node
// run-backtest.mjs — backtest the market-structure + Fibonacci strategies across
// all markets/symbols/timeframes and print a comparison table.

import { writeFileSync } from "node:fs";
import { fetchOHLCV, getSymbols, displayName, MARKETS } from "./marketData.mjs";
import { STRATEGIES, STRATEGY_LABELS } from "./strategies.mjs";
import { runBacktest } from "./backtest.mjs";

const TIMEFRAMES = ["1d", "4h", "1h"];

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--market") out.market = a[++i];
    else if (a[i] === "--symbol") out.symbol = a[++i];
    else if (a[i] === "--tf") out.timeframe = a[++i];
    else if (a[i] === "--strategy") out.strategy = a[++i];
    else if (a[i] === "--limit") out.limit = parseInt(a[++i], 10) || 500;
  }
  return out;
}

const args = parseArgs();
const markets = args.market ? [args.market] : MARKETS;
const timeframes = args.timeframe ? [args.timeframe] : TIMEFRAMES;
const strategies = args.strategy ? [args.strategy] : Object.keys(STRATEGIES);

const results = [];
console.log(`\n=== QUANT BACKTEST: market-structure + Fibonacci ===`);
console.log(`Markets: ${markets.join(", ")} | TFs: ${timeframes.join(", ")} | Strategies: ${strategies.join(", ")}\n`);

for (const market of markets) {
  const symbols = args.symbol ? [args.symbol] : getSymbols(market);
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      console.log(`-- ${displayName(symbol, market)} (${market}) ${timeframe} --`);
      const bars = await fetchOHLCV(symbol, market, timeframe, args.limit ?? 500);
      console.log(`  fetched ${bars.length} bars [${bars[0]?.timestamp?.toISOString().slice(0,10)} .. ${bars[bars.length-1]?.timestamp?.toISOString().slice(0,10)}]`);

      for (const strategy of strategies) {
        const fn = STRATEGIES[strategy];
        const res = runBacktest(bars, fn, { initialBalance: 10000, riskPerTrade: 1, warmup: 60 });
        const m = res.metrics;
        results.push({
          market, symbol: displayName(symbol, market), timeframe, strategy,
          label: STRATEGY_LABELS[strategy],
          period: m.period, bars: bars.length,
          returnPct: +m.totalReturnPct.toFixed(2),
          cagr: +m.cagrPct.toFixed(2),
          trades: m.totalTrades,
          winRate: +m.winRate.toFixed(1),
          pf: m.profitFactor === Infinity ? "Inf" : +m.profitFactor.toFixed(2),
          sharpe: +m.sharpe.toFixed(2),
          maxDD: +m.maxDrawdownPct.toFixed(2),
          avgR: +m.avgRMultiple.toFixed(2),
          finalEquity: +m.finalEquity.toFixed(0),
        });
        console.log(
          `  ${strategy.padEnd(15)} ret=${results[results.length-1].returnPct.toString().padStart(8)}%  cagr=${results[results.length-1].cagr}%  trades=${String(m.totalTrades).padStart(4)}  wr=${m.winRate.toFixed(0)}%  pf=${String(results[results.length-1].pf).padStart(5)}  sharpe=${m.sharpe.toFixed(2)}  maxDD=${m.maxDrawdownPct.toFixed(0)}%  avgR=${m.avgRMultiple.toFixed(2)}`
        );
      }
    }
  }
}

// ---- ranking: best CAGR with sane risk (sharpe > 0.5, maxDD < 40%, trades >= 10) ----
const viable = results.filter(
  (r) => r.sharpe > 0.5 && r.maxDD < 40 && r.trades >= 10 && Number.isFinite(r.cagr)
);
const ranked = [...viable].sort((a, b) => b.cagr - a.cagr);

console.log(`\n\n===== RANKING (sharpe>0.5, maxDD<40%, trades>=10, by CAGR) ====`);
console.log(
  ["market", "symbol", "tf", "strategy", "return%", "cagr%", "trades", "wr%", "pf", "sharpe", "maxDD%"].join("\t")
);
for (const r of ranked.slice(0, 20)) {
  console.log([r.market, r.symbol, r.timeframe, r.strategy, r.returnPct, r.cagr, r.trades, r.winRate, r.pf, r.sharpe, r.maxDD].join("\t"));
}

const summary = { generatedAt: new Date().toISOString(), results, ranked: ranked.slice(0, 50) };
writeFileSync("quant-results.json", JSON.stringify(summary, null, 2));
console.log(`\nWrote quant-results.json (${results.length} runs, ${ranked.length} viable)`);
