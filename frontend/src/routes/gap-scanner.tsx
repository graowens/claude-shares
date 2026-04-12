import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import {
  getGapResults,
  runGapScan,
  toggleGapSelect,
  confirmGapSelection,
  clearSelectedGaps,
  getSettings,
  updateSettings,
  type GapScanResult,
  type Settings,
} from "@/lib/api";
import { cn, formatCurrency, getMarketStatus, exchangeColor, type MarketStatus } from "@/lib/utils";
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
  TrendingUp,
  Search,
  Loader2,
  CheckCircle2,
  Save,
  Clock,
  X,
} from "lucide-react";

export const gapScannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gap-scanner",
  component: GapScannerPage,
});

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toLocaleString("en-GB");
}

function marketStatusConfig(status: MarketStatus) {
  switch (status) {
    case "open":
      return { label: "Market Open", className: "bg-emerald-500/15 text-emerald-400" };
    case "pre-market":
      return { label: "Pre-Market", className: "bg-yellow-500/15 text-yellow-400" };
    case "closed":
      return { label: "Market Closed", className: "bg-red-500/15 text-red-400" };
  }
}

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
  // Gap-up contexts
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
  // Gap-down contexts
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

function isHighQualityContext(ctx: string | null): boolean {
  if (!ctx) return false;
  const c = ctx.toLowerCase();
  return (
    c.includes("ends downtrend") ||
    c.includes("above 200ma") ||
    c.includes("above 200") ||
    c.includes("ends uptrend") ||
    c.includes("below 200ma") ||
    c.includes("below 200")
  );
}

type GapFilter = "all" | "up" | "down";

function GapScannerPage() {
  const queryClient = useQueryClient();
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [gapFilter, setGapFilter] = useState<GapFilter>("all");
  const marketStatus = getMarketStatus();
  const statusConfig = marketStatusConfig(marketStatus);

  // Settings for daily session config
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const [sessionForm, setSessionForm] = useState<{
    dailyBudget: number;
    dailyLossLimit: number;
    dailyProfitTarget: number;
  }>({
    dailyBudget: 100,
    dailyLossLimit: 20,
    dailyProfitTarget: 180,
  });

  // Sync form when settings load
  const settingsData = settingsQuery.data;
  useState(() => {
    if (settingsData) {
      setSessionForm({
        dailyBudget: settingsData.dailyBudget ?? 100,
        dailyLossLimit: settingsData.dailyLossLimit ?? 20,
        dailyProfitTarget: settingsData.dailyProfitTarget ?? 180,
      });
    }
  });

  // Update form when settings data changes
  const [syncedSettings, setSyncedSettings] = useState(false);
  if (settingsData && !syncedSettings) {
    setSessionForm({
      dailyBudget: settingsData.dailyBudget ?? 100,
      dailyLossLimit: settingsData.dailyLossLimit ?? 20,
      dailyProfitTarget: settingsData.dailyProfitTarget ?? 180,
    });
    setSyncedSettings(true);
  }

  const saveSettingsMut = useMutation({
    mutationFn: (data: Partial<Settings>) => {
      const current = settingsData ?? {
        maxPositionSize: 5000,
        stopLossPercent: 2,
        takeProfitPercent: 3,
        maxDailyLoss: 500,
        currency: "GBP" as const,
        maxConcurrentTrades: 3,
        dailyBudget: 100,
        dailyLossLimit: 20,
        dailyProfitTarget: 180,
        allowShortSelling: false,
        exchanges: "NASDAQ,NYSE",
      };
      return updateSettings({ ...current, ...data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Gap results
  const gapQuery = useQuery({
    queryKey: ["gap-results"],
    queryFn: () => getGapResults(),
  });

  const scanMut = useMutation({
    mutationFn: runGapScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gap-results"] });
    },
  });

  const toggleMut = useMutation({
    mutationFn: toggleGapSelect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gap-results"] });
    },
  });

  const confirmMut = useMutation({
    mutationFn: confirmGapSelection,
    onSuccess: (data) => {
      setConfirmMsg(`${data.count} stock${data.count !== 1 ? "s" : ""} added to watchlist`);
      queryClient.invalidateQueries({ queryKey: ["gap-results"] });
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const clearSelectedMut = useMutation({
    mutationFn: () => clearSelectedGaps(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gap-results"] });
    },
  });

  const results = (gapQuery.data ?? []).map((g) => ({
    ...g,
    gapPercent: Number(g.gapPercent),
    prevClose: Number(g.prevClose),
    currentPrice: Number(g.currentPrice),
    preMarketVolume: Number(g.preMarketVolume),
    ma20: g.ma20 != null ? Number(g.ma20) : null,
    ma200: g.ma200 != null ? Number(g.ma200) : null,
  }));
  const filtered = results.filter((r) => {
    if (gapFilter === "up") return r.gapPercent > 0;
    if (gapFilter === "down") return r.gapPercent < 0;
    return true;
  });
  const sorted = [...filtered].sort(
    (a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent)
  );
  const selectedCount = results.filter((r) => r.selected).length;
  const currency = settingsData?.currency ?? "GBP";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold">Extended Hours Gaps</h1>
        </div>
        <div className={cn("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium", statusConfig.className)}>
          <Clock className="h-3.5 w-3.5" />
          {statusConfig.label}
        </div>
      </div>

      {/* Daily Session Config */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="dailyBudget" className="text-xs text-muted-foreground">
                Daily Budget
              </Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currency === "GBP" ? "\u00a3" : "$"}
                </span>
                <Input
                  id="dailyBudget"
                  type="number"
                  step="10"
                  className="w-28 pl-7"
                  value={sessionForm.dailyBudget}
                  onChange={(e) =>
                    setSessionForm((f) => ({ ...f, dailyBudget: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dailyLossLimit" className="text-xs text-muted-foreground">
                Loss Limit
              </Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currency === "GBP" ? "\u00a3" : "$"}
                </span>
                <Input
                  id="dailyLossLimit"
                  type="number"
                  step="5"
                  className="w-28 pl-7"
                  value={sessionForm.dailyLossLimit}
                  onChange={(e) =>
                    setSessionForm((f) => ({ ...f, dailyLossLimit: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dailyProfitTarget" className="text-xs text-muted-foreground">
                Profit Target
              </Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currency === "GBP" ? "\u00a3" : "$"}
                </span>
                <Input
                  id="dailyProfitTarget"
                  type="number"
                  step="10"
                  className="w-28 pl-7"
                  value={sessionForm.dailyProfitTarget}
                  onChange={(e) =>
                    setSessionForm((f) => ({ ...f, dailyProfitTarget: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveSettingsMut.mutate(sessionForm)}
              disabled={saveSettingsMut.isPending}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saveSettingsMut.isPending ? "Saving..." : "Save"}
            </Button>
            {saveSettingsMut.isSuccess && (
              <Badge variant="success">Saved</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scan Controls */}
      <div className="flex items-center gap-4">
        <Button
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
        >
          {scanMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          {scanMut.isPending ? "Scanning..." : "Scan for Gaps"}
        </Button>
        {scanMut.isError && (
          <Badge variant="danger">Scan failed: {scanMut.error.message}</Badge>
        )}
        {gapQuery.isLoading && (
          <span className="text-sm text-muted-foreground">Loading results...</span>
        )}
      </div>

      {/* Results Table */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Gap Scan Results
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {sorted.length} stock{sorted.length !== 1 ? "s" : ""} shown
                </span>
              </CardTitle>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {(["all", "up", "down"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setGapFilter(f)}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                      gapFilter === f
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f === "all" ? "All" : f === "up" ? "Gap Up" : "Gap Down"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Gap %</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Prev Close</TableHead>
                  <TableHead>Pre-Mkt Vol</TableHead>
                  <TableHead>20MA</TableHead>
                  <TableHead>200MA</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>Daily Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((gap) => {
                  const isGapUp = gap.gapPercent >= 0;
                  return (
                  <TableRow
                    key={gap.id}
                    className={cn(
                      "cursor-pointer transition-colors",
                      gap.selected
                        ? isGapUp
                          ? "border-l-2 border-l-emerald-400 bg-emerald-500/5"
                          : "border-l-2 border-l-red-400 bg-red-500/5"
                        : "opacity-70 hover:opacity-100",
                      isHighQualityContext(gap.dailyContext) && !gap.selected
                        ? "opacity-85"
                        : ""
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
                    <TableCell className="font-bold text-base">
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
                        {isGapUp ? "+" : ""}{gap.gapPercent.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatCurrency(gap.currentPrice, currency)}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {formatCurrency(gap.prevClose, currency)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatVolume(gap.preMarketVolume)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {gap.ma20 != null ? gap.ma20.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {gap.ma200 != null ? gap.ma200.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell>{trendBadge(gap.trendDirection)}</TableCell>
                    <TableCell>{contextBadge(gap.dailyContext)}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && !gapQuery.isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <TrendingUp className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              No gap scan results yet. Click "Scan for Gaps" to find pre-market gaps.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Best used between 10:00 - 14:30 UK time (pre-market hours)
            </p>
          </CardContent>
        </Card>
      )}

      {/* Selected Summary */}
      {results.length > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                <span className="text-lg font-bold text-foreground">{selectedCount}</span>{" "}
                stock{selectedCount !== 1 ? "s" : ""} selected
              </span>
            </div>
            <div className="flex items-center gap-3">
              {confirmMsg && (
                <Badge variant="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {confirmMsg}
                </Badge>
              )}
              {confirmMut.isError && (
                <Badge variant="danger">Failed: {confirmMut.error.message}</Badge>
              )}
              {selectedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearSelectedMut.mutate()}
                  disabled={clearSelectedMut.isPending}
                >
                  {clearSelectedMut.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Clear Selected
                </Button>
              )}
              <Button
                onClick={() => confirmMut.mutate()}
                disabled={selectedCount === 0 || confirmMut.isPending}
              >
                {confirmMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {confirmMut.isPending ? "Confirming..." : "Confirm & Add to Watchlist"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
