import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./__root";
import { getSettings, updateSettings, type Settings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Save } from "lucide-react";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const [form, setForm] = useState<Settings>({
    maxPositionSize: 5000,
    stopLossPercent: 2,
    takeProfitPercent: 3,
    maxDailyLoss: 500,
    currency: "GBP",
    maxConcurrentTrades: 3,
  });

  useEffect(() => {
    if (settings.data) {
      setForm(settings.data);
    }
  }, [settings.data]);

  const saveMut = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const handleSave = () => {
    saveMut.mutate(form);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Trading Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {settings.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : settings.isError ? (
            <p className="text-sm text-red-400">
              Failed to load settings. Using defaults.
            </p>
          ) : null}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxPositionSize">Max Position Size ($)</Label>
              <Input
                id="maxPositionSize"
                type="number"
                step="100"
                value={form.maxPositionSize}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxPositionSize: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDailyLoss">Max Daily Loss ($)</Label>
              <Input
                id="maxDailyLoss"
                type="number"
                step="50"
                value={form.maxDailyLoss}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxDailyLoss: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stopLossPercent">Stop Loss %</Label>
              <Input
                id="stopLossPercent"
                type="number"
                step="0.1"
                value={form.stopLossPercent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    stopLossPercent: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="takeProfitPercent">Take Profit %</Label>
              <Input
                id="takeProfitPercent"
                type="number"
                step="0.1"
                value={form.takeProfitPercent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    takeProfitPercent: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                id="currency"
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    currency: e.target.value as "GBP" | "USD",
                  }))
                }
              >
                <option value="GBP">GBP (\u00a3)</option>
                <option value="USD">USD ($)</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxConcurrentTrades">Max Concurrent Trades</Label>
              <Input
                id="maxConcurrentTrades"
                type="number"
                step="1"
                min="1"
                value={form.maxConcurrentTrades}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxConcurrentTrades: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {saveMut.isPending ? "Saving..." : "Save Settings"}
            </Button>
            {saveMut.isSuccess && (
              <Badge variant="success">Settings saved</Badge>
            )}
            {saveMut.isError && (
              <Badge variant="danger">
                Failed to save: {saveMut.error.message}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
