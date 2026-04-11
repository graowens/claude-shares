import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { getTrades, createTrade } from "@/lib/api";
import { formatCurrency, formatDate, plClass } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

export const tradesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trades",
  component: TradesPage,
});

function TradesPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const trades = useQuery({
    queryKey: ["trades", statusFilter],
    queryFn: () =>
      getTrades(statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: createTrade,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      setDialogOpen(false);
    },
  });

  const [form, setForm] = useState({
    symbol: "",
    side: "buy" as "buy" | "sell",
    quantity: "",
  });

  const handleSubmit = () => {
    if (!form.symbol || !form.quantity) return;
    createMutation.mutate({
      symbol: form.symbol.toUpperCase(),
      side: form.side,
      quantity: Number(form.quantity),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trades</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Manual Trade
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter}>
          <Card>
            <CardContent className="pt-6">
              {trades.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : trades.isError ? (
                <p className="text-sm text-red-400">
                  Failed to load trades. Is the backend running?
                </p>
              ) : !trades.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No trades found.
                </p>
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
                      <TableHead>Strategy</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.data.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">
                          {t.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              t.side === "buy" ? "success" : "danger"
                            }
                          >
                            {t.side.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>{t.quantity}</TableCell>
                        <TableCell>{formatCurrency(t.entryPrice)}</TableCell>
                        <TableCell>
                          {t.exitPrice
                            ? formatCurrency(t.exitPrice)
                            : "--"}
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
                          {t.strategy || "--"}
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
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Manual Trade</DialogTitle>
          <DialogDescription>
            Place a manual paper trade.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              placeholder="AAPL"
              value={form.symbol}
              onChange={(e) =>
                setForm((f) => ({ ...f, symbol: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="side">Side</Label>
            <Select
              id="side"
              value={form.side}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  side: e.target.value as "buy" | "sell",
                }))
              }
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              placeholder="100"
              value={form.quantity}
              onChange={(e) =>
                setForm((f) => ({ ...f, quantity: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Placing..." : "Place Trade"}
            </Button>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-red-400">
              Failed to place trade. {createMutation.error.message}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
