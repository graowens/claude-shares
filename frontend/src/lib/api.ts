const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new ApiError(res.status, text);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, `Network error: ${(err as Error).message}`);
  }
}

// Account
export interface Account {
  buyingPower: number;
  equity: number;
  plToday: number;
  currency: "USD" | "GBP";
}

export const getAccount = () => request<Account>("/account");

// Trades
export interface Trade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  pl: number;
  status: "open" | "closed";
  strategy: string;
  createdAt: string;
}

export const getTrades = (params?: { status?: string; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return request<Trade[]>(`/trades${qs ? `?${qs}` : ""}`);
};

export const createTrade = (data: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
}) => request<Trade>("/trades", { method: "POST", body: JSON.stringify(data) });

// P&L
export interface PnlSummary {
  today: number;
  week: number;
  month: number;
  allTime: number;
}

export const getPnl = () => request<PnlSummary>("/trades/pnl");

// Watchlist
export interface WatchlistItem {
  id: string;
  symbol: string;
  gapDirection: "up" | "down";
  targetEntry: number;
  stopLoss: number;
  takeProfit: number;
  scheduledDate: string;
  active: boolean;
  notes: string;
}

export const getWatchlist = () => request<WatchlistItem[]>("/watchlist");

export const createWatchlistItem = (data: Omit<WatchlistItem, "id">) =>
  request<WatchlistItem>("/watchlist", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateWatchlistItem = (id: string, data: Partial<WatchlistItem>) =>
  request<WatchlistItem>(`/watchlist/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteWatchlistItem = (id: string) =>
  request<void>(`/watchlist/${id}`, { method: "DELETE" });

export const bulkAddWatchlist = (items: Omit<WatchlistItem, "id">[]) =>
  request<WatchlistItem[]>("/watchlist/bulk", {
    method: "POST",
    body: JSON.stringify(items),
  });

// Backtest
export interface BacktestParams {
  symbol: string;
  startDate: string;
  endDate: string;
  stopLossPercent: number;
  takeProfitPercent: number;
  entryDelayMinutes: number;
}

export interface BacktestResult {
  id: string;
  params: BacktestParams;
  totalTrades: number;
  winRate: number;
  totalPl: number;
  maxDrawdown: number;
  createdAt: string;
}

export const runBacktest = (params: BacktestParams) =>
  request<BacktestResult>("/backtest/run", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const getBacktestResults = () =>
  request<BacktestResult[]>("/backtest/results");

// Capitol Trades
export interface CapitolTrade {
  id: string;
  politician: string;
  symbol: string;
  tradeType: string;
  amount: string;
  filedDate: string;
}

export const getCapitolTrades = () =>
  request<CapitolTrade[]>("/scraper/results");

export const runScraper = () =>
  request<{ message: string }>("/scraper/run", { method: "POST" });

// Transcripts
export interface Transcript {
  id: string;
  filename: string;
  title: string;
  createdAt: string;
}

export const getTranscripts = () =>
  request<Transcript[]>("/transcripts");

export const getTranscriptContent = (id: string) =>
  request<{ content: string }>(`/transcripts/${id}`);

// Strategies
export interface Strategy {
  id: number;
  name: string;
  description: string;
  source: string | null;
  params: Record<string, any> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getStrategies = () => request<Strategy[]>("/strategies");

export const getEnabledStrategies = () => request<Strategy[]>("/strategies/enabled");

export const createStrategy = (data: { name: string; description: string; source?: string; params?: Record<string, any>; enabled?: boolean }) =>
  request<Strategy>("/strategies", { method: "POST", body: JSON.stringify(data) });

export const updateStrategy = (id: number, data: Partial<Strategy>) =>
  request<Strategy>(`/strategies/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const toggleStrategy = (id: number) =>
  request<Strategy>(`/strategies/${id}/toggle`, { method: "PATCH" });

export const deleteStrategy = (id: number) =>
  request<void>(`/strategies/${id}`, { method: "DELETE" });

// Settings
export interface Settings {
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLoss: number;
  currency: "GBP" | "USD";
  maxConcurrentTrades: number;
}

export const getSettings = () => request<Settings>("/settings");

export const updateSettings = (data: Settings) =>
  request<Settings>("/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
