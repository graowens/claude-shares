import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import {
  runBacktest,
  getBacktestResults,
  runHistoricalGapScan,
  clearSelectedGaps,
  toggleGapSelect,
  runBacktestFromGaps,
  type BacktestParams,
  type GapScanResult,
  type BacktestFromGapsResult,
} from "@/lib/api";
import { cn, formatCurrency, formatDate, plClass, exchangeColor } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FlaskConical,
  Search,
  Loader2,
  CheckCircle2,
  ArrowDown,
  X,
  TrendingUp,
  TrendingDown,
  Target,
  BarChart3,
  Play,
} from "lucide-react";

export const backtestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backtest",
  component: BacktestPage,
});

function trendBadge(trend: string | null) {
  if (!trend) return null;
  const t = trend.toLowerCase();
  if (t.includes("up"))
    return <Badge variant="success">Uptrend</Badge>;
  if (t.includes("down"))
    return <Badge variant="danger">Downtrend</Badge>;
  return <Badge variant="warning">Sideways</Badge>;
}

function contextBadge(ctx: string | null) {
  if (!ctx) return <Badge variant="secondary">Other</Badge>;
  const c = ctx.toLowerCase();
  if (c.includes("ends downtrend"))
    return (
      <Badge className="border-transparent bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30">
        Ends Downtrend
      </Badge>
    );
  if (c.includes("above 200ma") || c.includes("above 200"))
    return (
      <Badge className="border-transparent bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30">
        Above 200MA
      </Badge>
    );
  if (c.includes("above resistance"))
    return <Badge variant="success">Above Resistance</Badge>;
  if (c.includes("ends uptrend"))
    return (
      <Badge className="border-transparent bg-red-500/20 text-red-300 ring-1 ring-red-500/30">
        Ends Uptrend
      </Badge>
    );
  if (c.includes("below 200ma") || c.includes("below 200"))
    return (
      <Badge className="border-transparent bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/30">
        Below 200MA
      </Badge>
    );
  if (c.includes("below support"))
    return (
      <Badge className="border-transparent bg-red-500/20 text-red-300 ring-1 ring-red-500/30">
        Below Support
      </Badge>
    );
  return <Badge variant="secondary">{ctx}</Badge>;
}

function exitReasonBadge(reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("take profit") || r.includes("tp"))
    return <Badge variant="success">Take Profit</Badge>;
  if (r.includes("stop loss") || r.includes("sl"))
    return <Badge variant="danger">Stop Loss</Badge>;
  if (r.includes("end of hour") || r.includes("eoh") || r.includes("time"))
    return <Badge variant="warning">End of Hour</Badge>;
  return <Badge variant="secondary">{reason}</Badge>;
}

function BacktestPage() {
  const queryClient = useQueryClient();
  const [scanDate, setScanDate] = useState("");
  const [symbolsInput, setSymbolsInput] = useState("");
  const [stopLoss, setStopLoss] = useState("1");
  const [takeProfit, setTakeProfit] = useState("2");
  const [startingCapital, setStartingCapital] = useState("100");
  const [scanResults, setScanResults] = useState<GapScanResult[]>([]);
  const [backtestResult, setBacktestResult] = useState<BacktestFromGapsResult | null>(null);

  // History
  const historyQuery = useQuery({
    queryKey: ["backtest-results"],
    queryFn: getBacktestResults,
  });

  // Scan mutation
  const scanMut = useMutation({
    mutationFn: () => {
      const symbols = symbolsInput.trim()
        ? symbolsInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
        : undefined;
      return runHistoricalGapScan(scanDate, symbols);
    },
    onSuccess: (data) => {
      setScanResults(data.map((g) => ({
        ...g,
        gapPercent: Number(g.gapPercent),
        prevClose: Number(g.prevClose),
        currentPrice: Number(g.currentPrice),
        preMarketVolume: Number(g.preMarketVolume),
        ma20: g.ma20 != null ? Number(g.ma20) : null,
        ma200: g.ma200 != null ? Number(g.ma200) : null,
      })));
      setBacktestResult(null);
    },
  });

  // Toggle selection
  const toggleMut = useMutation({
    mutationFn: toggleGapSelect,
    onSuccess: (updated) => {
      setScanResults((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, selected: updated.selected } : r))
      );
    },
  });

  // Clear selected
  const clearMut = useMutation({
    mutationFn: () => clearSelectedGaps(scanDate),
    onSuccess: () => {
      setScanResults((prev) => prev.map((r) => ({ ...r, selected: false })));
    },
  });

  // Run backtest from gaps
  const backtestMut = useMutation({
    mutationFn: () =>
      runBacktestFromGaps({
        scanDate,
        stopLossPercent: Number(stopLoss),
        takeProfitPercent: Number(takeProfit),
        startingCapital: Number(startingCapital),
      }),
    onSuccess: (data) => {
      setBacktestResult(data);
      queryClient.invalidateQueries({ queryKey: ["backtest-results"] });
    },
  });

  const sorted = [...scanResults].sort(
    (a, b) => Math.abs(Number(b.gapPercent)) - Math.abs(Number(a.gapPercent))
  );
  const selectedCount = scanResults.filter((r) => r.selected).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="h-6 w-6 text-violet-400" />
        <div>
          <h1 className="text-2xl font-bold">Gap Backtest</h1>
          <p className="text-sm text-muted-foreground">
            Pick a past date, see what gaps existed, then simulate trading them
          </p>
        </div>
      </div>

      {/* Step 1: Scan Historical Gaps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
              1
            </div>
            Scan Historical Gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="scanDate" className="text-xs text-muted-foreground">
                Scan Date
              </Label>
              <Input
                id="scanDate"
                type="date"
                className="w-44"
                value={scanDate}
                onChange={(e) => setScanDate(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="symbols" className="text-xs text-muted-foreground">
                Symbols (optional, comma-separated)
              </Label>
              <Input
                id="symbols"
                placeholder="AAPL, TSLA, MSFT"
                value={symbolsInput}
                onChange={(e) => setSymbolsInput(e.target.value)}
              />
            </div>
            <Button
              onClick={() => scanMut.mutate()}
              disabled={!scanDate || scanMut.isPending}
            >
              {scanMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              {scanMut.isPending ? "Scanning..." : "Scan Gaps"}
            </Button>
          </div>
          {scanMut.isError && (
            <p className="text-sm text-red-400">
              Scan failed: {scanMut.error.message}
            </p>
          )}

          {/* Scan Results Table */}
          {sorted.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {sorted.length} gap{sorted.length !== 1 ? "s" : ""} found
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    <span className="font-bold text-foreground">{selectedCount}</span>{" "}
                    <span className="text-muted-foreground">selected</span>
                  </span>
                  {selectedCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearMut.mutate()}
                      disabled={clearMut.isPending}
                    >
                      {clearMut.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Clear Selected
                    </Button>
                  )}
                </div>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Exchange</TableHead>
                      <TableHead>Gap %</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Daily Context</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((gap) => {
                      const gapPct = Number(gap.gapPercent);
                      const isGapUp = gapPct >= 0;
                      return (
                        <TableRow
                          key={gap.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            gap.selected
                              ? isGapUp
                                ? "border-l-2 border-l-emerald-400 bg-emerald-500/5"
                                : "border-l-2 border-l-red-400 bg-red-500/5"
                              : "opacity-70 hover:opacity-100"
                          )}
                          onClick={() => toggleMut.mutate(gap.id)}
                        >
                          <TableCell>
                            <div
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded border",
                                gap.selected
                                  ? isGapUp
                                    ? "border-emerald-400 bg-emerald-400 text-black"
                                    : "border-red-400 bg-red-400 text-black"
                                  : "border-muted-foreground/30"
                              )}
                            >
                              {gap.selected && <CheckCircle2 className="h-3.5 w-3.5" />}
                            </div>
                          </TableCell>
                          <TableCell className="font-bold">
                            <a
                              href={`https://www.tradingview.com/chart/?symbol=${gap.symbol}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "underline decoration-dotted underline-offset-2",
                                isGapUp
                                  ? "text-emerald-400 hover:text-emerald-300"
                                  : "text-red-400 hover:text-red-300"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {gap.symbol}
                            </a>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("border text-xs", exchangeColor(gap.exchange))}>
                              {gap.exchange ?? "\u2014"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={isGapUp ? "success" : "danger"}
                              className="text-sm font-semibold"
                            >
                              {isGapUp ? "+" : ""}{gapPct.toFixed(1)}%
                            </Badge>
                          </TableCell>
                          <TableCell>{trendBadge(gap.trendDirection)}</TableCell>
                          <TableCell>{contextBadge(gap.dailyContext)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {scanMut.isSuccess && sorted.length === 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              No gaps found for this date.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step connector */}
      {scanResults.length > 0 && (
        <div className="flex justify-center">
          <ArrowDown className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}

      {/* Step 2: Run Backtest */}
      {scanResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-400">
                2
              </div>
              Run Backtest
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{selectedCount}</span> stock{selectedCount !== 1 ? "s" : ""} selected for backtest
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startingCapital" className="text-xs text-muted-foreground">
                  Starting Capital
                </Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    id="startingCapital"
                    type="number"
                    step="10"
                    min="10"
                    className="w-32 pl-6"
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stopLoss" className="text-xs text-muted-foreground">
                  Stop Loss %
                </Label>
                <Input
                  id="stopLoss"
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="w-24"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="takeProfit" className="text-xs text-muted-foreground">
                  Take Profit %
                </Label>
                <Input
                  id="takeProfit"
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="w-24"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
              </div>
              <Button
                onClick={() => backtestMut.mutate()}
                disabled={selectedCount === 0 || backtestMut.isPending}
              >
                {backtestMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {backtestMut.isPending ? "Running..." : "Run Backtest on Selected"}
              </Button>
            </div>
            {backtestMut.isError && (
              <p className="text-sm text-red-400">
                Backtest failed: {backtestMut.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Backtest Results */}
      {backtestResult && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Total Trades</p>
                    <p className="text-2xl font-bold">{backtestResult.totalTrades}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Target className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className={cn(
                      "text-2xl font-bold",
                      backtestResult.winRate >= 50 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {Number(backtestResult.winRate).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  {backtestResult.totalPnl >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-400" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Total P/L</p>
                    <p className={cn("text-2xl font-bold", plClass(backtestResult.totalPnl))}>
                      {formatCurrency(backtestResult.totalPnl)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div>
                  <p className="text-xs text-muted-foreground">Starting Capital</p>
                  <p className="text-2xl font-bold text-muted-foreground">
                    {formatCurrency(backtestResult.params.startingCapital ?? Number(startingCapital))}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div>
                  <p className="text-xs text-muted-foreground">Final Equity</p>
                  <p className={cn(
                    "text-2xl font-bold",
                    (backtestResult.params.finalEquity ?? 0) >= (backtestResult.params.startingCapital ?? Number(startingCapital))
                      ? "text-emerald-400"
                      : "text-red-400"
                  )}>
                    {formatCurrency(backtestResult.params.finalEquity ?? 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Trades Table */}
          {backtestResult.params.trades && backtestResult.params.trades.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Individual Trades</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Gap %</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>P/L</TableHead>
                      <TableHead>P/L %</TableHead>
                      <TableHead>Equity</TableHead>
                      <TableHead>Exit Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backtestResult.params.trades.map((trade, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-bold">
                          <a
                            href={`https://www.tradingview.com/chart/?symbol=${trade.symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 underline decoration-dotted underline-offset-2 hover:text-violet-300"
                          >
                            {trade.symbol}
                          </a>
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.side.toLowerCase() === "buy" ? "success" : "danger"}>
                            {trade.side}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={trade.gapPercent >= 0 ? "success" : "danger"}
                            className="font-semibold"
                          >
                            {trade.gapPercent >= 0 ? "+" : ""}{trade.gapPercent.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatCurrency(trade.entryPrice)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatCurrency(trade.exitPrice)}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {trade.shares ?? "—"}
                        </TableCell>
                        <TableCell className={cn("font-mono font-semibold", plClass(trade.pnl))}>
                          {formatCurrency(trade.pnl)}
                        </TableCell>
                        <TableCell className={cn("font-mono", plClass(trade.pnlPercent))}>
                          {trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {trade.equityAfter != null ? formatCurrency(trade.equityAfter) : "—"}
                        </TableCell>
                        <TableCell>{exitReasonBadge(trade.exitReason)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>Backtest History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : historyQuery.isError ? (
            <p className="text-sm text-red-400">
              Failed to load backtest history.
            </p>
          ) : !historyQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">
              No backtest results yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Date Range</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Total P/L</TableHead>
                  <TableHead>Max Drawdown</TableHead>
                  <TableHead>Run Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyQuery.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.params.symbol}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.params.startDate} - {r.params.endDate}
                    </TableCell>
                    <TableCell>{r.totalTrades}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.winRate >= 50 ? "success" : "danger"}
                      >
                        {Number(r.winRate).toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className={plClass(r.totalPl)}>
                      {formatCurrency(r.totalPl)}
                    </TableCell>
                    <TableCell className="text-red-400">
                      {formatCurrency(r.maxDrawdown)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
