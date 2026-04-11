import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { getCapitolTrades, runScraper, createWatchlistItem } from "@/lib/api";
import { formatDateShort } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Plus } from "lucide-react";

export const capitolTradesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/capitol-trades",
  component: CapitolTradesPage,
});

function CapitolTradesPage() {
  const queryClient = useQueryClient();

  const trades = useQuery({
    queryKey: ["capitol-trades"],
    queryFn: getCapitolTrades,
  });

  const scrapeMut = useMutation({
    mutationFn: runScraper,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["capitol-trades"] });
    },
  });

  const watchlistMut = useMutation({
    mutationFn: createWatchlistItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const addToWatchlist = (symbol: string, type: string) => {
    const direction = type.toLowerCase().includes("purchase") ? "up" : "down";
    watchlistMut.mutate({
      symbol: symbol.toUpperCase(),
      gapDirection: direction as "up" | "down",
      targetEntry: 0,
      stopLoss: 0,
      takeProfit: 0,
      scheduledDate: new Date().toISOString().split("T")[0],
      active: true,
      notes: `From Capitol Trades - ${type}`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Capitol Trades</h1>
        <Button
          onClick={() => scrapeMut.mutate()}
          disabled={scrapeMut.isPending}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${scrapeMut.isPending ? "animate-spin" : ""}`}
          />
          {scrapeMut.isPending ? "Scraping..." : "Run Scraper"}
        </Button>
      </div>

      {scrapeMut.isSuccess && (
        <Badge variant="success">Scrape completed successfully</Badge>
      )}
      {scrapeMut.isError && (
        <Badge variant="danger">
          Scrape failed: {scrapeMut.error.message}
        </Badge>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Congressional Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {trades.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : trades.isError ? (
            <p className="text-sm text-red-400">
              Failed to load Capitol trades. Is the backend running?
            </p>
          ) : !trades.data?.length ? (
            <p className="text-sm text-muted-foreground">
              No Capitol trades found. Run the scraper to fetch data.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Politician</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Filed Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.politician}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.symbol}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.tradeType.toLowerCase().includes("purchase")
                            ? "success"
                            : "danger"
                        }
                      >
                        {t.tradeType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.amount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateShort(t.filedDate)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addToWatchlist(t.symbol, t.tradeType)}
                        disabled={watchlistMut.isPending}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Watchlist
                      </Button>
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
