#!/usr/bin/env node
// run-daily.mjs — generate the DAILY QUANT report across all markets.

import { writeFileSync } from "node:fs";
import { fetchOHLCV, getSymbols, displayName, MARKETS } from "./marketData.mjs";
import { generateReport, printReport } from "./report.mjs";

const TIMEFRAME = "1d";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--market") out.market = a[++i];
    else if (a[i] === "--symbol") out.symbol = a[++i];
  }
  return out;
}

const args = parseArgs();
const markets = args.market ? [args.market] : MARKETS;
const reports = [];

console.log(`\n===== DAILY QUANT REPORT (${TIMEFRAME}) =====\n`);

for (const market of markets) {
  const symbols = args.symbol ? [args.symbol] : getSymbols(market);
  for (const symbol of symbols) {
    const name = displayName(symbol, market);
    console.log(`-- ${name} (${market}) --`);
    const bars = await fetchOHLCV(symbol, market, TIMEFRAME, 500);
    const report = generateReport(bars, { symbol: name, market, timeframe: TIMEFRAME });
    reports.push(report);
    printReport(report);
    console.log("");
  }
  console.log("");
}

writeFileSync("quant-daily-report.json", JSON.stringify({ generatedAt: new Date().toISOString(), timeframe: TIMEFRAME, reports }, null, 2));

// Summary line
const actionable = reports.filter((r) => r?.signal?.dir !== "HOLD" && r?.signal?.dir);
console.log(`===== ACTIONABLE SIGNALS: ${actionable.length}/${reports.length} =====`);
for (const r of actionable) {
  console.log(`${r.symbol.padEnd(12)} ${r.signal.dir.padEnd(5)} conf=${String(r.signal.confidence).padStart(3)}%  entry=${r.signal.entry}  sl=${r.signal.stopLoss}  tp=${r.signal.takeProfit}`);
}
console.log(`\nWrote quant-daily-report.json`);
