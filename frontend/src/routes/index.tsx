import { createRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { getAccount, getPnl, getTrades } from "@/lib/api";
import {
  formatCurrency,
  formatDate,
  getMarketStatus,
  plClass,
  type MarketStatus,
} from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
} from "lucide-react";

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

function MarketStatusBadge() {
  const status: MarketStatus = getMarketStatus();
  const config = {
    open: { variant: "success" as const, label: "Market Open" },
    closed: { variant: "danger" as const, label: "Market Closed" },
    "pre-market": { variant: "warning" as const, label: "Pre-Market" },
  };
  const { variant, label } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function Dashboard() {
  const account = useQuery({ queryKey: ["account"], queryFn: getAccount });
  const pnl = useQuery({ queryKey: ["pnl"], queryFn: getPnl });
  const trades = useQuery({
    queryKey: ["trades", "recent"],
    queryFn: () => getTrades({ limit: 10 }),
  });

  const openCount =
    trades.data?.filter((t) => t.status === "open").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <MarketStatusBadge />
      </div>

      {/* Account summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Buying Power</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {account.data
                ? formatCurrency(account.data.buyingPower, account.data.currency)
                : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Equity</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {account.data
                ? formatCurrency(account.data.equity, account.data.currency)
                : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">P/L Today</CardTitle>
            {(account.data?.plToday ?? 0) >= 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${plClass(account.data?.plToday ?? 0)}`}
            >
              {account.data
                ? formatCurrency(account.data.plToday, account.data.currency)
                : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Positions
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* P&L Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        {(["today", "week", "month", "allTime"] as const).map((period) => {
          const labels = {
            today: "Today",
            week: "This Week",
            month: "This Month",
            allTime: "All Time",
          };
          const value = pnl.data?.[period] ?? 0;
          return (
            <Card key={period}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {labels[period]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-xl font-bold ${plClass(value)}`}>
                  {pnl.data ? formatCurrency(value) : "--"}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent trades */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {trades.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : trades.isError ? (
            <p className="text-sm text-red-400">
              Failed to load trades. Is the backend running?
            </p>
          ) : !trades.data?.length ? (
            <p className="text-sm text-muted-foreground">No trades yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead>P/L</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant={t.side === "buy" ? "success" : "danger"}
                      >
                        {t.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{t.quantity}</TableCell>
                    <TableCell>{formatCurrency(t.entryPrice)}</TableCell>
                    <TableCell>
                      {t.exitPrice ? formatCurrency(t.exitPrice) : "--"}
                    </TableCell>
                    <TableCell className={plClass(t.pl)}>
                      {formatCurrency(t.pl)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "open" ? "success" : "secondary"
                        }
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.createdAt)}
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
