import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  History,
  Play,
  BarChart3,
  TrendingUp,
  Target,
  Shield,
  Award,
  FileBarChart,
  Loader2,
} from "lucide-react";

const QUANT_MARKETS = [
  { id: "crypto", name: "Crypto" },
  { id: "stocks", name: "Stocks" },
  { id: "commodities", name: "Commodities" },
  { id: "forex", name: "Forex" },
] as const;

const QUANT_TIMEFRAMES = [
  { id: "1d", name: "1 Day" },
  { id: "4h", name: "4 Hours" },
  { id: "1h", name: "1 Hour" },
  { id: "1w", name: "1 Week" },
] as const;

const STRATEGIES = [
  {
    id: "fib_retrace",
    name: "Fibonacci Retracement",
    description: "Pullback into 0.382/0.5/0.618 with market structure",
  },
  {
    id: "fib_extension",
    name: "Fibonacci Extension",
    description: "Momentum breakout targeting 1.272-1.618 extensions",
  },
  {
    id: "breakout",
    name: "Breakout",
    description: "N-bar range breakout with ATR stop",
  },
  {
    id: "trend_follow",
    name: "EMA Trend",
    description: "EMA20/50 crossover baseline",
  },
] as const;

export default function Backtest() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [market, setMarket] = useState<"crypto" | "stocks" | "commodities" | "forex">("crypto");
  const [timeframe, setTimeframe] = useState<"1d" | "4h" | "1h" | "1w">("1d");
  const [strategy, setStrategy] = useState<"fib_retrace" | "fib_extension" | "breakout" | "trend_follow">("fib_retrace");

  const backtestQuery = trpc.quant.run.useQuery(
    { symbol, market, timeframe, strategy },
    { enabled: false }
  );

  const compareQuery = trpc.quant.compare.useQuery(
    { symbol, market, timeframe },
    { enabled: false }
  );

  const [reportMarket, setReportMarket] = useState<"all" | "crypto" | "stocks" | "commodities" | "forex">("all");
  const reportQuery = trpc.quant.report.useQuery({ market: reportMarket }, { enabled: false });

  const result = backtestQuery.data;
  const metrics = result?.metrics;
  const actionable = reportQuery.data?.filter(
    (r) => r.signal && r.signal.dir !== "HOLD" && r.error == null
  );

  const runBacktest = () => {
    backtestQuery.refetch();
    compareQuery.refetch();
  };

  const loadReport = () => {
    reportQuery.refetch();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <History className="w-8 h-8 text-blue-400" />
          Quant Backtest Engine
        </h1>
        <p className="text-gray-400 mt-1">
          Market structure + Fibonacci strategies on historical data
        </p>
      </div>

      {/* Configuration */}
      <div className="bg-[#111827] rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Backtest Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Market</label>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {QUANT_MARKETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {QUANT_TIMEFRAMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={runBacktest}
              disabled={backtestQuery.isFetching}
              className="w-full bg-blue-600 hover:bg-blue-500 py-2"
            >
              {backtestQuery.isFetching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {backtestQuery.isFetching ? "Running..." : "Run Backtest"}
            </Button>
          </div>
        </div>
      </div>

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {STRATEGIES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStrategy(s.id as any)}
            className={`p-4 rounded-xl border text-left transition-all ${
              strategy === s.id
                ? "border-blue-500 bg-blue-500/10"
                : "border-gray-800 bg-[#111827] hover:border-gray-700"
            }`}
          >
            <h4 className="text-white font-medium">{s.name}</h4>
            <p className="text-sm text-gray-400 mt-1">{s.description}</p>
          </button>
        ))}
      </div>

      {/* Results */}
      {result && metrics && (
        <>
          <div className="bg-[#111827] rounded-xl border border-gray-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-1">
              Backtest Results: {symbol} - {STRATEGIES.find((s) => s.id === strategy)?.name}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {metrics.period} · {metrics.totalTrades} trades · 1% risk/trade
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ResultCard
                label="Total Return"
                value={`${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct.toFixed(2)}%`}
                icon={<TrendingUp className="w-5 h-5" />}
                color={metrics.totalReturnPct >= 0 ? "text-green-400" : "text-red-400"}
              />
              <ResultCard
                label="CAGR"
                value={`${metrics.cagrPct >= 0 ? "+" : ""}${metrics.cagrPct.toFixed(2)}%`}
                icon={<BarChart3 className="w-5 h-5" />}
                color={metrics.cagrPct >= 0 ? "text-green-400" : "text-red-400"}
              />
              <ResultCard
                label="Win Rate"
                value={`${metrics.winRate.toFixed(1)}%`}
                icon={<Target className="w-5 h-5" />}
                color="text-blue-400"
              />
              <ResultCard
                label="Sharpe Ratio"
                value={metrics.sharpe.toFixed(2)}
                icon={<Award className="w-5 h-5" />}
                color="text-yellow-400"
              />
              <ResultCard
                label="Max Drawdown"
                value={`-${metrics.maxDrawdownPct.toFixed(2)}%`}
                icon={<Shield className="w-5 h-5" />}
                color="text-red-400"
              />
              <ResultCard
                label="Profit Factor"
                value={Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : "∞"}
                icon={<BarChart3 className="w-5 h-5" />}
                color="text-green-400"
              />
              <ResultCard
                label="Avg R-Multiple"
                value={`${metrics.avgRMultiple >= 0 ? "+" : ""}${metrics.avgRMultiple.toFixed(2)}R`}
                icon={<TrendingUp className="w-5 h-5" />}
                color={metrics.avgRMultiple >= 0 ? "text-green-400" : "text-red-400"}
              />
              <ResultCard
                label="Avg Win/Loss"
                value={`$${metrics.avgWin.toFixed(0)} / $${metrics.avgLoss.toFixed(0)}`}
                icon={<Target className="w-5 h-5" />}
                color="text-purple-400"
              />
            </div>
          </div>

          {/* Equity Curve */}
          <div className="bg-[#111827] rounded-xl border border-gray-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Equity Curve</h3>
            <div className="h-64 flex items-end gap-px">
              {(() => {
                const maxEquity = Math.max(...result.equityCurve.map((a) => a.equity));
                const minEquity = Math.min(...result.equityCurve.map((a) => a.equity));
                const range = maxEquity - minEquity || 1;
                return result.equityCurve.map((point, i) => {
                  const height = ((point.equity - minEquity) / range) * 100;
                  const up = i === 0 || point.equity >= result.equityCurve[i - 1].equity;
                  return (
                    <div
                      key={i}
                      className={`flex-1 transition-colors ${up ? "bg-green-500/60" : "bg-red-500/60"}`}
                      style={{ height: `${Math.max(3, height)}%` }}
                      title={`$${point.equity.toFixed(2)}`}
                    />
                  );
                });
              })()}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>{metrics.initialBalance}</span>
              <span>${metrics.finalEquity.toFixed(2)}</span>
            </div>
          </div>

          {/* Strategy Comparison */}
          {compareQuery.data && (
            <div className="bg-[#111827] rounded-xl border border-gray-800 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Strategy Comparison — {symbol} {timeframe}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4 text-sm text-gray-400">Strategy</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">Return</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">CAGR</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">Win Rate</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">Trades</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">Sharpe</th>
                      <th className="text-right py-3 px-4 text-sm text-gray-400">Max DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareQuery.data.map((item: any, i: number) => (
                      <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/30">
                        <td className="py-3 px-4 text-white font-medium">{item.label ?? item.strategy}</td>
                        {item.error ? (
                          <td colSpan={6} className="py-3 px-4 text-right text-red-400 text-sm">
                            {item.error}
                          </td>
                        ) : (
                          <>
                            <td className={`py-3 px-4 text-right ${item.totalReturnPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {item.totalReturnPct >= 0 ? "+" : ""}
                              {item.totalReturnPct.toFixed(2)}%
                            </td>
                            <td className={`py-3 px-4 text-right ${item.cagrPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {item.cagrPct >= 0 ? "+" : ""}
                              {item.cagrPct.toFixed(2)}%
                            </td>
                            <td className="py-3 px-4 text-right text-blue-400">{item.winRate.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right text-gray-300">{item.totalTrades}</td>
                            <td className="py-3 px-4 text-right text-yellow-400">{item.sharpe.toFixed(2)}</td>
                            <td className="py-3 px-4 text-right text-red-400">-{item.maxDrawdownPct.toFixed(1)}%</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Daily Quant Report */}
      <div className="bg-[#111827] rounded-xl border border-gray-800 p-6">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileBarChart className="w-5 h-5 text-blue-400" />
            Daily Quant Report
          </h3>
          <select
            value={reportMarket}
            onChange={(e) => setReportMarket(e.target.value as any)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Markets</option>
            {QUANT_MARKETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Button onClick={loadReport} disabled={reportQuery.isFetching} className="bg-blue-600 hover:bg-blue-500 py-1.5 text-sm">
            {reportQuery.isFetching ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileBarChart className="w-4 h-4 mr-2" />
            )}
            {reportQuery.isFetching ? "Building..." : "Load Today's Report"}
          </Button>
        </div>
        {reportQuery.error ? (
          <p className="text-red-400 text-sm">{reportQuery.error.message}</p>
        ) : actionable && actionable.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm text-gray-400">Market</th>
                  <th className="text-left py-3 px-4 text-sm text-gray-400">Symbol</th>
                  <th className="text-left py-3 px-4 text-sm text-gray-400">Signal</th>
                  <th className="text-right py-3 px-4 text-sm text-gray-400">Conf</th>
                  <th className="text-right py-3 px-4 text-sm text-gray-400">Entry</th>
                  <th className="text-right py-3 px-4 text-sm text-gray-400">Stop Loss</th>
                  <th className="text-right py-3 px-4 text-sm text-gray-400">Take Profit</th>
                  <th className="text-right py-3 px-4 text-sm text-gray-400">Trend</th>
                </tr>
              </thead>
              <tbody>
                {actionable.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/30">
                    <td className="py-3 px-4 text-gray-400 capitalize">{r.market}</td>
                    <td className="py-3 px-4 text-white font-medium">{r.symbol}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-sm font-semibold ${
                          r.signal!.dir === "BUY"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {r.signal!.dir}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-yellow-400">{r.signal!.confidence}%</td>
                    <td className="py-3 px-4 text-right text-gray-200">{r.signal!.entry ?? "—"}</td>
                    <td className="py-3 px-4 text-right text-red-400">{r.signal!.stopLoss ?? "—"}</td>
                    <td className="py-3 px-4 text-right text-green-400">{r.signal!.takeProfit ?? "—"}</td>
                    <td className="py-3 px-4 text-right text-gray-300">{r.structure?.trend}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {actionable.length === 0 && (
              <p className="text-gray-400 text-sm py-4">No actionable signals in the current selection.</p>
            )}
          </div>
        ) : !reportQuery.isFetching && !reportQuery.data ? (
          <p className="text-gray-500 text-sm">
            Load the report to see today's BUY/SELL/HOLD signals with Fibonacci levels.
          </p>
        ) : (
          <p className="text-gray-500 text-sm py-2">
            {reportQuery.isFetching ? "Fetching live data across markets..." : "No actionable signals right now."}
          </p>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
      <div className="flex items-center gap-2 mb-2">
        <span className={color}>{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}