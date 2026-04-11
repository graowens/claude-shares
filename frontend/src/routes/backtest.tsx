import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { runBacktest, getBacktestResults, type BacktestParams } from "@/lib/api";
import { formatCurrency, formatDate, plClass } from "@/lib/utils";
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
import { FlaskConical, Play } from "lucide-react";

export const backtestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backtest",
  component: BacktestPage,
});

function BacktestPage() {
  const [form, setForm] = useState({
    symbol: "",
    startDate: "",
    endDate: "",
    stopLossPercent: "2",
    takeProfitPercent: "3",
    entryDelayMinutes: "5",
  });

  const results = useQuery({
    queryKey: ["backtest-results"],
    queryFn: getBacktestResults,
  });

  const runMut = useMutation({
    mutationFn: runBacktest,
  });

  const handleRun = () => {
    if (!form.symbol || !form.startDate || !form.endDate) return;
    const params: BacktestParams = {
      symbol: form.symbol.toUpperCase(),
      startDate: form.startDate,
      endDate: form.endDate,
      stopLossPercent: Number(form.stopLossPercent),
      takeProfitPercent: Number(form.takeProfitPercent),
      entryDelayMinutes: Number(form.entryDelayMinutes),
    };
    runMut.mutate(params);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Backtest</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Run Backtest
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input
                placeholder="AAPL"
                value={form.symbol}
                onChange={(e) =>
                  setForm((f) => ({ ...f, symbol: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Stop Loss %</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.stopLossPercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      stopLossPercent: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Take Profit %</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.takeProfitPercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      takeProfitPercent: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Entry Delay (min)</Label>
                <Input
                  type="number"
                  value={form.entryDelayMinutes}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      entryDelayMinutes: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <Button
              className="w-full"
              onClick={handleRun}
              disabled={runMut.isPending}
            >
              <Play className="mr-2 h-4 w-4" />
              {runMut.isPending ? "Running..." : "Run Backtest"}
            </Button>
            {runMut.isError && (
              <p className="text-sm text-red-400">
                Backtest failed. {runMut.error.message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Latest result */}
        {runMut.data && (
          <Card>
            <CardHeader>
              <CardTitle>Result: {runMut.data.params.symbol}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Trades</p>
                  <p className="text-2xl font-bold">
                    {runMut.data.totalTrades}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                  <p className="text-2xl font-bold">
                    {(runMut.data.winRate * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total P/L</p>
                  <p
                    className={`text-2xl font-bold ${plClass(runMut.data.totalPl)}`}
                  >
                    {formatCurrency(runMut.data.totalPl)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Max Drawdown</p>
                  <p className="text-2xl font-bold text-red-400">
                    {formatCurrency(runMut.data.maxDrawdown)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>Backtest History</CardTitle>
        </CardHeader>
        <CardContent>
          {results.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : results.isError ? (
            <p className="text-sm text-red-400">
              Failed to load backtest history.
            </p>
          ) : !results.data?.length ? (
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
                {results.data.map((r) => (
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
                        variant={r.winRate >= 0.5 ? "success" : "danger"}
                      >
                        {(r.winRate * 100).toFixed(1)}%
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
