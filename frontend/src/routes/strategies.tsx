import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import {
  getStrategies,
  createStrategy,
  updateStrategy,
  toggleStrategy,
  toggleStrategyBacktest,
  bulkSetEnabled,
  bulkSetBacktest,
  deleteStrategy,
  type Strategy,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, FlaskConical, Power, PowerOff } from "lucide-react";

export const strategiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/strategies",
  component: StrategiesPage,
});

const emptyForm = {
  name: "",
  description: "",
  source: "",
  enabled: true,
  backtestEnabled: true,
  params: "",
};

function StrategiesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();

  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: getStrategies,
  });

  const createMut = useMutation({
    mutationFn: createStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Strategy> }) =>
      updateStrategy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setDialogOpen(false);
      setEditId(null);
      setForm(emptyForm);
    },
  });

  const toggleMut = useMutation({
    mutationFn: toggleStrategy,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const toggleBacktestMut = useMutation({
    mutationFn: toggleStrategyBacktest,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const bulkEnabledMut = useMutation({
    mutationFn: bulkSetEnabled,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const bulkBacktestMut = useMutation({
    mutationFn: bulkSetBacktest,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setDeleteConfirmId(null);
    },
  });

  const handleSubmit = () => {
    let parsedParams: Record<string, any> | undefined;
    if (form.params.trim()) {
      try {
        parsedParams = JSON.parse(form.params);
      } catch {
        alert("Invalid JSON in params field");
        return;
      }
    }

    const data = {
      name: form.name,
      description: form.description,
      source: form.source || undefined,
      params: parsedParams,
      enabled: form.enabled,
      backtestEnabled: form.backtestEnabled,
    };

    if (editId !== null) {
      updateMut.mutate({ id: editId, data });
    } else {
      createMut.mutate(data);
    }
  };

  const openEdit = (strategy: Strategy) => {
    setEditId(strategy.id);
    setForm({
      name: strategy.name,
      description: strategy.description,
      source: strategy.source ?? "",
      enabled: strategy.enabled,
      backtestEnabled: strategy.backtestEnabled,
      params: strategy.params ? JSON.stringify(strategy.params, null, 2) : "",
    });
    setDialogOpen(true);
  };

  const items = strategies.data ?? [];
  const enabledCount = items.filter((s) => s.enabled).length;
  const backtestCount = items.filter((s) => s.backtestEnabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Strategies</h1>
          {items.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {enabledCount} live, {backtestCount} backtesting &mdash; {items.length} total
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <>
              <div className="flex items-center gap-1 rounded-md border border-border p-1">
                <span className="px-1.5 text-xs text-muted-foreground">Live</span>
                <Button
                  variant={enabledCount === items.length ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => bulkEnabledMut.mutate(true)}
                  disabled={bulkEnabledMut.isPending}
                >
                  <Power className="mr-1 h-3 w-3" />
                  All On
                </Button>
                <Button
                  variant={enabledCount === 0 ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => bulkEnabledMut.mutate(false)}
                  disabled={bulkEnabledMut.isPending}
                >
                  <PowerOff className="mr-1 h-3 w-3" />
                  All Off
                </Button>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border p-1">
                <FlaskConical className="ml-1 h-3.5 w-3.5 text-violet-400" />
                <span className="px-0.5 text-xs text-muted-foreground">Backtest</span>
                <Button
                  variant={backtestCount === items.length ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => bulkBacktestMut.mutate(true)}
                  disabled={bulkBacktestMut.isPending}
                >
                  <Power className="mr-1 h-3 w-3" />
                  All On
                </Button>
                <Button
                  variant={backtestCount === 0 ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => bulkBacktestMut.mutate(false)}
                  disabled={bulkBacktestMut.isPending}
                >
                  <PowerOff className="mr-1 h-3 w-3" />
                  All Off
                </Button>
              </div>
            </>
          )}
          <Button
            onClick={() => {
              setEditId(null);
              setForm(emptyForm);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Strategy
          </Button>
        </div>
      </div>

      {strategies.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : strategies.isError ? (
        <p className="text-sm text-red-400">
          Failed to load strategies. Is the backend running?
        </p>
      ) : !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No strategies yet. Add one to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((strategy) => (
            <Card
              key={strategy.id}
              className={cn(
                "border-l-4",
                strategy.enabled
                  ? "border-l-emerald-500"
                  : "border-l-zinc-600"
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{strategy.name}</CardTitle>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <FlaskConical className="h-3.5 w-3.5 text-violet-400" />
                      <span className="text-xs text-muted-foreground">Backtest</span>
                      <Switch
                        checked={strategy.backtestEnabled}
                        onCheckedChange={() => toggleBacktestMut.mutate(strategy.id)}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {strategy.enabled ? "Live" : "Disabled"}
                      </span>
                      <Switch
                        checked={strategy.enabled}
                        onCheckedChange={() => toggleMut.mutate(strategy.id)}
                      />
                    </div>
                  </div>
                </div>
                {strategy.source && (
                  <Badge variant="outline" className="w-fit mt-1">
                    {strategy.source}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {strategy.description}
                </p>

                {strategy.params &&
                  Object.keys(strategy.params).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Parameters
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(strategy.params).map(([key, value]) => (
                          <Badge
                            key={key}
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {key}: {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(strategy)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirmId(strategy.id)}
                  >
                    <Trash2 className="mr-1 h-3 w-3 text-red-400" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editId !== null ? "Edit" : "Add"} Strategy
          </DialogTitle>
          <DialogDescription>
            {editId !== null
              ? "Update the strategy details."
              : "Define a new trading strategy."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Gap & Go Momentum"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={6}
              placeholder="Describe the strategy rules, entry/exit criteria, etc."
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source (optional)</Label>
              <Input
                placeholder="e.g. emmanuel-1.txt"
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value }))
                }
              />
            </div>
            <div className="flex items-end gap-4 pb-0.5">
              <div className="flex items-center gap-2">
                <Label>Live</Label>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, enabled: checked }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Label>Backtest</Label>
                <Switch
                  checked={form.backtestEnabled}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, backtestEnabled: checked }))
                  }
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Parameters (JSON, optional)</Label>
            <Textarea
              rows={4}
              placeholder='{"stopLoss": 2, "takeProfit": 4}'
              className="font-mono text-sm"
              value={form.params}
              onChange={(e) =>
                setForm((f) => ({ ...f, params: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !form.name.trim() ||
                !form.description.trim() ||
                createMut.isPending ||
                updateMut.isPending
              }
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving..."
                : editId !== null
                  ? "Update"
                  : "Add"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete Strategy</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this strategy? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (deleteConfirmId !== null) {
                deleteMut.mutate(deleteConfirmId);
              }
            }}
            disabled={deleteMut.isPending}
          >
            {deleteMut.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
