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
  optimiseClaude,
  getEmanuelPicks,
  type BacktestParams,
  type GapScanResult,
  type BacktestFromGapsResult,
  type ClaudeOptimiseResult,
  type EmanuelPicksResult,
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
  Star,
  Info,
  Users,
  Brain,
  Zap,
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

function scoreBadge(score: number) {
  if (score >= 50)
    return (
      <Badge className="border-transparent bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30 font-bold">
        <Star className="mr-1 h-3 w-3 fill-emerald-400" />
        {score}
      </Badge>
    );
  if (score >= 30)
    return (
      <Badge className="border-transparent bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/30 font-bold">
        {score}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="font-bold opacity-60">
      {score}
    </Badge>
  );
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
  const [claudeResult, setClaudeResult] = useState<ClaudeOptimiseResult | null>(null);
  const [emanuelPicks, setEmanuelPicks] = useState<EmanuelPicksResult | null>(null);

  // Emanuel top picks (2-week lookback)
  const emanuelMut = useMutation({
    mutationFn: () => getEmanuelPicks(scanDate, Number(startingCapital) || 1000),
    onSuccess: (data) => setEmanuelPicks(data),
  });

  // Claude optimiser
  const claudeMut = useMutation({
    mutationFn: () => optimiseClaude(Number(startingCapital) || 10000),
    onSuccess: (data) => setClaudeResult(data),
  });

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
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || Math.abs(Number(b.gapPercent)) - Math.abs(Number(a.gapPercent))
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
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {sorted.length} gap{sorted.length !== 1 ? "s" : ""} found
                  </span>
                  {(() => {
                    const highQuality = sorted.filter((g) => (g.score ?? 0) >= 50).length;
                    return highQuality > 0 ? (
                      <span className="text-sm">
                        <Star className="inline h-3.5 w-3.5 fill-emerald-400 text-emerald-400 mr-1" />
                        <span className="font-bold text-emerald-400">{highQuality}</span>
                        <span className="text-muted-foreground"> high quality</span>
                      </span>
                    ) : (
                      <span className="text-sm text-yellow-400">
                        No high-quality setups — Emanuel would pass
                      </span>
                    );
                  })()}
                </div>
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
                      <TableHead>Emanuel Score</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Exchange</TableHead>
                      <TableHead>Gap %</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Daily Context</TableHead>
                      <TableHead>Why</TableHead>
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
                              : (gap.score ?? 0) >= 50
                                ? "border-l-2 border-l-violet-400/50 opacity-90 hover:opacity-100"
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
                          <TableCell>{scoreBadge(gap.score ?? 0)}</TableCell>
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
                          <TableCell>
                            {gap.scoreReasons && gap.scoreReasons.length > 0 ? (
                              <div className="group relative">
                                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                                <div className="invisible group-hover:visible absolute left-0 bottom-full mb-2 z-50 w-64 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                                  <ul className="space-y-1">
                                    {gap.scoreReasons.map((r, i) => (
                                      <li key={i} className="flex items-start gap-1.5">
                                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                                        {r}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
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

      {/* Emanuel's Top Picks — 2 Week Lookback */}
      {scanDate && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Star className="h-5 w-5 text-amber-400" />
                Emanuel's Top 3 Picks — 2 Week Lookback
              </CardTitle>
              <Button
                onClick={() => emanuelMut.mutate()}
                disabled={!scanDate || emanuelMut.isPending}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {emanuelMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {emanuelMut.isPending ? "Analysing..." : "Run Emanuel's Picks"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Goes back 10 trading days before {scanDate || "the selected date"}, picks the top 3 stocks Emanuel would choose each day, and shows the P/L outcome
            </p>
          </CardHeader>
          {emanuelMut.isError && (
            <CardContent>
              <p className="text-sm text-red-400">Failed: {emanuelMut.error.message}</p>
            </CardContent>
          )}
          {emanuelPicks && (
            <CardContent className="space-y-4 pt-0">
              {/* Totals Summary */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card className="bg-amber-500/5 border-amber-500/20">
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Total P/L</p>
                    <p className={cn("text-2xl font-bold", plClass(emanuelPicks.totals.totalPnl))}>
                      {formatCurrency(emanuelPicks.totals.totalPnl)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className={cn("text-2xl font-bold", emanuelPicks.totals.winRate >= 50 ? "text-emerald-400" : "text-red-400")}>
                      {emanuelPicks.totals.winRate.toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Trades</p>
                    <p className="text-2xl font-bold">
                      {emanuelPicks.totals.totalWins}W / {emanuelPicks.totals.totalTrades - emanuelPicks.totals.totalWins}L
                    </p>
                  </CardContent>
                </Card>
                {emanuelPicks.totals.bestDay && (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">Best Day</p>
                      <p className="text-lg font-bold text-emerald-400">
                        {formatCurrency(emanuelPicks.totals.bestDay.pnl)}
                      </p>
                      <p className="text-xs text-muted-foreground">{emanuelPicks.totals.bestDay.date}</p>
                    </CardContent>
                  </Card>
                )}
                {emanuelPicks.totals.worstDay && (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">Worst Day</p>
                      <p className="text-lg font-bold text-red-400">
                        {formatCurrency(emanuelPicks.totals.worstDay.pnl)}
                      </p>
                      <p className="text-xs text-muted-foreground">{emanuelPicks.totals.worstDay.date}</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Per-day breakdown */}
              {emanuelPicks.days.map((day) => (
                <Card key={day.scanDate} className={cn(
                  "border-l-4",
                  day.dayPnl > 0 ? "border-l-emerald-500" : day.dayPnl < 0 ? "border-l-red-500" : "border-l-zinc-600"
                )}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-sm font-mono">{day.scanDate}</CardTitle>
                        <span className="text-xs text-muted-foreground">trades {day.tradingDay}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {day.dayTrades > 0 && (
                          <Badge variant={day.dayWins === day.dayTrades ? "success" : day.dayWins > 0 ? "warning" : "danger"}>
                            {day.dayWins}/{day.dayTrades} wins
                          </Badge>
                        )}
                        <span className={cn("font-mono font-bold", plClass(day.dayPnl))}>
                          {formatCurrency(day.dayPnl)}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>Gap</TableHead>
                          <TableHead>Context</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead>Entry</TableHead>
                          <TableHead>Exit</TableHead>
                          <TableHead>P/L</TableHead>
                          <TableHead>P/L %</TableHead>
                          <TableHead>Exit Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {day.picks.map((pick, idx) => (
                          <TableRow key={pick.symbol} className={cn(
                            pick.trade
                              ? pick.trade.pnl > 0
                                ? "bg-emerald-500/5"
                                : pick.trade.pnl < 0
                                  ? "bg-red-500/5"
                                  : ""
                              : "opacity-50"
                          )}>
                            <TableCell className="font-bold text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-bold">
                              <a
                                href={`https://www.tradingview.com/chart/?symbol=${pick.symbol}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-amber-400 underline decoration-dotted underline-offset-2 hover:text-amber-300"
                              >
                                {pick.symbol}
                              </a>
                            </TableCell>
                            <TableCell>
                              {pick.score >= 50 ? (
                                <Badge className="border-transparent bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30 font-bold">
                                  <Star className="mr-1 h-3 w-3 fill-emerald-400" />{pick.score}
                                </Badge>
                              ) : pick.score >= 30 ? (
                                <Badge className="border-transparent bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/30 font-bold">
                                  {pick.score}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="font-bold opacity-60">{pick.score}</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={pick.gapPercent >= 0 ? "success" : "danger"} className="font-semibold">
                                {pick.gapPercent >= 0 ? "+" : ""}{pick.gapPercent.toFixed(1)}%
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">
                                {pick.dailyContext.replace(/_/g, " ")}
                              </span>
                            </TableCell>
                            {pick.trade ? (
                              <>
                                <TableCell>
                                  <Badge variant={pick.trade.side === "buy" ? "success" : "danger"}>
                                    {pick.trade.side}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono">{formatCurrency(pick.trade.entryPrice)}</TableCell>
                                <TableCell className="font-mono">{formatCurrency(pick.trade.exitPrice)}</TableCell>
                                <TableCell className={cn("font-mono font-semibold", plClass(pick.trade.pnl))}>
                                  {formatCurrency(pick.trade.pnl)}
                                </TableCell>
                                <TableCell className={cn("font-mono", plClass(pick.trade.pnlPercent))}>
                                  {pick.trade.pnlPercent >= 0 ? "+" : ""}{pick.trade.pnlPercent.toFixed(2)}%
                                </TableCell>
                                <TableCell>{exitReasonBadge(pick.trade.exitReason)}</TableCell>
                              </>
                            ) : (
                              <TableCell colSpan={6} className="text-xs text-muted-foreground italic">
                                {pick.skippedReason || "No trade"}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          )}
        </Card>
      )}

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
                  Stop Loss % <span className="text-violet-400">(Emanuel: 1%)</span>
                </Label>
                <Input
                  id="stopLoss"
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="w-24"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="takeProfit" className="text-xs text-muted-foreground">
                  Take Profit % <span className="text-violet-400">(Emanuel: 2%)</span>
                </Label>
                <Input
                  id="takeProfit"
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="w-24"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="2"
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

          {/* Optimal SL/TP */}
          {backtestResult.params.optimalParams && (
            <Card className="border-violet-500/30 bg-violet-500/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <Target className="h-5 w-5 text-violet-400" />
                  <p className="font-semibold text-violet-300">Optimal Stop Loss / Take Profit for this day</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Best Stop Loss</p>
                    <p className="text-xl font-bold text-foreground">
                      {backtestResult.params.optimalParams.stopLoss}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Best Take Profit</p>
                    <p className="text-xl font-bold text-foreground">
                      {backtestResult.params.optimalParams.takeProfit}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Optimal P/L</p>
                    <p className={cn("text-xl font-bold", plClass(backtestResult.params.optimalParams.totalPnl))}>
                      {formatCurrency(backtestResult.params.optimalParams.totalPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Optimal Win Rate</p>
                    <p className={cn(
                      "text-xl font-bold",
                      backtestResult.params.optimalParams.winRate >= 50 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {backtestResult.params.optimalParams.winRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
                {(backtestResult.params.optimalParams.stopLoss !== backtestResult.params.stopLossPercent ||
                  backtestResult.params.optimalParams.takeProfit !== backtestResult.params.takeProfitPercent) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    You used SL {backtestResult.params.stopLossPercent}% / TP {backtestResult.params.takeProfitPercent}% &mdash; optimal would have been SL {backtestResult.params.optimalParams.stopLoss}% / TP {backtestResult.params.optimalParams.takeProfit}% for{" "}
                    {formatCurrency(backtestResult.params.optimalParams.totalPnl - backtestResult.totalPnl)} more P/L
                  </p>
                )}
              </CardContent>
            </Card>
          )}

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

          {/* Per-Author Strategy Comparison */}
          {backtestResult.params.perAuthorResults && Object.keys(backtestResult.params.perAuthorResults).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 text-violet-400" />
                  Strategy Author Comparison
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Author</TableHead>
                      <TableHead>Entry Method</TableHead>
                      <TableHead>Traded</TableHead>
                      <TableHead>Skipped</TableHead>
                      <TableHead>P/L</TableHead>
                      <TableHead>Win Rate</TableHead>
                      <TableHead>W / L</TableHead>
                      <TableHead>vs. You</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(backtestResult.params.perAuthorResults)
                      .sort(([, a], [, b]) => b.totalPnl - a.totalPnl)
                      .map(([author, result], idx) => {
                        const delta = result.totalPnl - backtestResult.totalPnl;
                        const isBest = idx === 0;
                        return (
                          <TableRow
                            key={author}
                            className={cn(isBest && "bg-emerald-500/5 border-l-2 border-l-emerald-400")}
                          >
                            <TableCell className="font-bold">
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-xs font-bold text-violet-400">
                                  {author[0]}
                                </div>
                                {author}
                                {isBest && <Badge variant="success" className="text-xs">Best</Badge>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">
                                {result.entryMethod || `SL ${result.stopLoss}% / TP ${result.takeProfit}%`}
                              </span>
                            </TableCell>
                            <TableCell>{result.totalTrades}</TableCell>
                            <TableCell>
                              {(result.skippedStocks ?? 0) > 0 ? (
                                <div className="group relative">
                                  <span className="text-yellow-400 cursor-help">{result.skippedStocks}</span>
                                  {result.skippedReasons && result.skippedReasons.length > 0 && (
                                    <div className="invisible group-hover:visible absolute left-0 bottom-full mb-2 z-50 w-72 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                                      <ul className="space-y-1">
                                        {result.skippedReasons.map((r, i) => (
                                          <li key={i} className="flex items-start gap-1.5">
                                            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
                                            {r}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className={cn("font-mono font-semibold", plClass(result.totalPnl))}>
                              {formatCurrency(result.totalPnl)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={result.winRate >= 50 ? "success" : "danger"}>
                                {result.winRate.toFixed(1)}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {result.wins}W / {result.losses}L
                            </TableCell>
                            <TableCell className={cn("font-mono", plClass(delta))}>
                              {delta >= 0 ? "+" : ""}{formatCurrency(delta)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>

                {/* Explanation cards */}
                <div className="space-y-2 px-6 pb-6">
                  {Object.entries(backtestResult.params.perAuthorResults)
                    .sort(([, a], [, b]) => b.totalPnl - a.totalPnl)
                    .map(([author, result]) => (
                    <div
                      key={author}
                      className="rounded-md border border-l-4 border-l-violet-500/50 p-3"
                    >
                      <p className="text-sm">
                        <span className="font-semibold text-foreground">{author}: </span>
                        <span className="text-muted-foreground">{result.explanation}</span>
                      </p>
                    </div>
                  ))}
                </div>
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

      {/* Claude Strategy Optimiser */}
      <Card className="border-blue-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-blue-400" />
            Claude's Stop Gap Reversal — Optimiser
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scans ALL cached gap dates, fetches daily bars for S/R detection, and sweeps parameter
            combinations to find the optimal settings for Claude's stop gap reversal strategy.
          </p>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => claudeMut.mutate()}
              disabled={claudeMut.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {claudeMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {claudeMut.isPending ? "Optimising (this may take a while)..." : "Run Optimiser"}
            </Button>
            {claudeMut.isError && (
              <p className="text-sm text-red-400">Failed: {claudeMut.error.message}</p>
            )}
          </div>

          {claudeResult && (
            <div className="space-y-4 pt-2">
              {/* Summary */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-blue-500/5 border-blue-500/20">
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Best P/L (all dates)</p>
                    <p className={cn("text-2xl font-bold", plClass(claudeResult.bestPnl))}>
                      {formatCurrency(claudeResult.bestPnl)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className={cn("text-2xl font-bold", claudeResult.bestWinRate >= 50 ? "text-emerald-400" : "text-red-400")}>
                      {claudeResult.bestWinRate.toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Total Trades</p>
                    <p className="text-2xl font-bold">{claudeResult.bestTrades}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">Dates / Stocks Analysed</p>
                    <p className="text-2xl font-bold">
                      {claudeResult.datesScanned}
                      <span className="text-sm font-normal text-muted-foreground"> / {claudeResult.totalStocksAnalysed}</span>
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Best Params */}
              <Card className="border-blue-500/20 bg-blue-500/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Target className="h-5 w-5 text-blue-400" />
                    <p className="font-semibold text-blue-300">Optimal Parameters</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Swing Lookback</p>
                      <p className="text-xl font-bold">{claudeResult.bestParams.swingLookback} bars</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Wait Bars (cascade)</p>
                      <p className="text-xl font-bold">{claudeResult.bestParams.waitBars} bars</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Stop Buffer</p>
                      <p className="text-xl font-bold">{(claudeResult.bestParams.stopBuffer * 100).toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rejection Threshold</p>
                      <p className="text-xl font-bold">{(claudeResult.bestParams.rejectionThreshold * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Per-Date Breakdown */}
              {claudeResult.perDateBreakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Per-Date Performance (Best Params)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scan Date</TableHead>
                          <TableHead>Trading Day</TableHead>
                          <TableHead>Stocks</TableHead>
                          <TableHead>Trades</TableHead>
                          <TableHead>P/L</TableHead>
                          <TableHead>Win Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {claudeResult.perDateBreakdown.map((d) => (
                          <TableRow key={d.scanDate}>
                            <TableCell className="font-mono">{d.scanDate}</TableCell>
                            <TableCell className="font-mono text-muted-foreground">{d.tradingDay}</TableCell>
                            <TableCell>{d.stocks}</TableCell>
                            <TableCell>{d.trades}</TableCell>
                            <TableCell className={cn("font-mono font-semibold", plClass(d.pnl))}>
                              {formatCurrency(d.pnl)}
                            </TableCell>
                            <TableCell>
                              {d.trades > 0 ? (
                                <Badge variant={d.winRate >= 50 ? "success" : "danger"}>
                                  {d.winRate.toFixed(1)}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Top Parameter Combos */}
              {claudeResult.allParamResults.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Top 20 Parameter Combinations</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Swing LB</TableHead>
                          <TableHead>Wait Bars</TableHead>
                          <TableHead>Stop Buffer</TableHead>
                          <TableHead>Rejection</TableHead>
                          <TableHead>Trades</TableHead>
                          <TableHead>W / L</TableHead>
                          <TableHead>Win Rate</TableHead>
                          <TableHead>Total P/L</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {claudeResult.allParamResults.map((r, i) => (
                          <TableRow
                            key={i}
                            className={cn(i === 0 && "bg-blue-500/5 border-l-2 border-l-blue-400")}
                          >
                            <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>{r.params.swingLookback}</TableCell>
                            <TableCell>{r.params.waitBars}</TableCell>
                            <TableCell>{(r.params.stopBuffer * 100).toFixed(2)}%</TableCell>
                            <TableCell>{(r.params.rejectionThreshold * 100).toFixed(0)}%</TableCell>
                            <TableCell>{r.totalTrades}</TableCell>
                            <TableCell className="text-muted-foreground">{r.wins}W / {r.losses}L</TableCell>
                            <TableCell>
                              <Badge variant={r.winRate >= 50 ? "success" : "danger"}>
                                {r.winRate.toFixed(1)}%
                              </Badge>
                            </TableCell>
                            <TableCell className={cn("font-mono font-semibold", plClass(r.totalPnl))}>
                              {formatCurrency(r.totalPnl)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
