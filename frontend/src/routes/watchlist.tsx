import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import {
  getWatchlist,
  createWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  bulkAddWatchlist,
  type WatchlistItem,
} from "@/lib/api";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Upload, Trash2, Pencil } from "lucide-react";

export const watchlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watchlist",
  component: WatchlistPage,
});

const emptyForm = {
  symbol: "",
  gapDirection: "up" as "up" | "down",
  targetEntry: "",
  stopLoss: "",
  takeProfit: "",
  scheduledDate: "",
  active: true,
  notes: "",
};

function WatchlistPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [bulkText, setBulkText] = useState("");
  const queryClient = useQueryClient();

  const watchlist = useQuery({
    queryKey: ["watchlist"],
    queryFn: getWatchlist,
  });

  const createMut = useMutation({
    mutationFn: createWatchlistItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setAddOpen(false);
      setForm(emptyForm);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WatchlistItem> }) =>
      updateWatchlistItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setEditId(null);
      setForm(emptyForm);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteWatchlistItem,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const bulkMut = useMutation({
    mutationFn: bulkAddWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setBulkOpen(false);
      setBulkText("");
    },
  });

  const handleSubmit = () => {
    const data = {
      symbol: form.symbol.toUpperCase(),
      gapDirection: form.gapDirection,
      targetEntry: Number(form.targetEntry),
      stopLoss: Number(form.stopLoss),
      takeProfit: Number(form.takeProfit),
      scheduledDate: form.scheduledDate,
      active: form.active,
      notes: form.notes,
    };
    if (editId) {
      updateMut.mutate({ id: editId, data });
    } else {
      createMut.mutate(data);
    }
  };

  const handleBulkAdd = () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const items = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        symbol: parts[0]?.toUpperCase() ?? "",
        gapDirection: (parts[1] === "down" ? "down" : "up") as "up" | "down",
        targetEntry: Number(parts[2]) || 0,
        stopLoss: Number(parts[3]) || 0,
        takeProfit: Number(parts[4]) || 0,
        scheduledDate: new Date().toISOString().split("T")[0],
        active: true,
        notes: "",
      };
    });
    bulkMut.mutate(items);
  };

  const openEdit = (item: WatchlistItem) => {
    setEditId(item.id);
    setForm({
      symbol: item.symbol,
      gapDirection: item.gapDirection,
      targetEntry: String(item.targetEntry),
      stopLoss: String(item.stopLoss),
      takeProfit: String(item.takeProfit),
      scheduledDate: item.scheduledDate,
      active: item.active,
      notes: item.notes,
    });
    setAddOpen(true);
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const todayItems =
    watchlist.data?.filter(
      (w) => w.scheduledDate === todayStr && w.active
    ) ?? [];
  const allItems = watchlist.data ?? [];

  const toggleActive = (item: WatchlistItem) => {
    updateMut.mutate({
      id: item.id,
      data: { active: !item.active },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Bulk Add
          </Button>
          <Button
            onClick={() => {
              setEditId(null);
              setForm(emptyForm);
              setAddOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Stock
          </Button>
        </div>
      </div>

      {/* Scheduled for today */}
      {todayItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Scheduled for Today
              <Badge variant="success">{todayItems.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {todayItems.map((item) => (
                <Badge key={item.id} variant="outline" className="text-sm py-1 px-3">
                  {item.symbol}{" "}
                  <span
                    className={
                      item.gapDirection === "up"
                        ? "text-emerald-400 ml-1"
                        : "text-red-400 ml-1"
                    }
                  >
                    {item.gapDirection === "up" ? "\u2191" : "\u2193"}
                  </span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full watchlist table */}
      <Card>
        <CardContent className="pt-6">
          {watchlist.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : watchlist.isError ? (
            <p className="text-sm text-red-400">
              Failed to load watchlist. Is the backend running?
            </p>
          ) : !allItems.length ? (
            <p className="text-sm text-muted-foreground">
              No watchlist items yet. Add some stocks to watch.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Gap</TableHead>
                  <TableHead>Target Entry</TableHead>
                  <TableHead>Stop Loss</TableHead>
                  <TableHead>Take Profit</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.symbol}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.gapDirection === "up" ? "success" : "danger"
                        }
                      >
                        {item.gapDirection.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(item.targetEntry)}</TableCell>
                    <TableCell>{formatCurrency(item.stopLoss)}</TableCell>
                    <TableCell>{formatCurrency(item.takeProfit)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateShort(item.scheduledDate)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.active}
                        onCheckedChange={() => toggleActive(item)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[150px] truncate">
                      {item.notes || "--"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMut.mutate(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setEditId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editId ? "Edit" : "Add"} Watchlist Item</DialogTitle>
          <DialogDescription>
            {editId ? "Update the watchlist entry." : "Add a stock to your watchlist."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label>Gap Direction</Label>
              <Select
                value={form.gapDirection}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    gapDirection: e.target.value as "up" | "down",
                  }))
                }
              >
                <option value="up">Up</option>
                <option value="down">Down</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Target Entry ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.targetEntry}
                onChange={(e) =>
                  setForm((f) => ({ ...f, targetEntry: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Stop Loss ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.stopLoss}
                onChange={(e) =>
                  setForm((f) => ({ ...f, stopLoss: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Take Profit ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.takeProfit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, takeProfit: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Scheduled Date</Label>
              <Input
                type="date"
                value={form.scheduledDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, scheduledDate: e.target.value }))
                }
              />
            </div>
            <div className="flex items-end gap-2">
              <Label>Active</Label>
              <Switch
                checked={form.active}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, active: checked }))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              placeholder="Optional notes..."
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editId ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Bulk add dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogHeader>
          <DialogTitle>Bulk Add to Watchlist</DialogTitle>
          <DialogDescription>
            One symbol per line, or CSV: SYMBOL,direction,entry,stop,target
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Textarea
            rows={8}
            placeholder={`AAPL,up,150.00,148.50,153.00\nTSLA,down,240.00,242.00,235.00\nMSFT`}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkAdd} disabled={bulkMut.isPending}>
              {bulkMut.isPending ? "Adding..." : "Add All"}
            </Button>
          </div>
          {bulkMut.isError && (
            <p className="text-sm text-red-400">
              Failed to bulk add. {bulkMut.error.message}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
