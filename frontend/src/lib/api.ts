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
  exchange?: string;
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
  exchange?: string;
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
  id: number;
  author: string;
  name: string;
  content?: string;
  createdAt: string;
}

export const getTranscripts = () =>
  request<Transcript[]>("/transcripts");

export const getTranscriptsByAuthor = () =>
  request<Record<string, Transcript[]>>("/transcripts/by-author");

export const getTranscriptContent = (id: number) =>
  request<Transcript>(`/transcripts/${id}`);

export const createTranscript = (data: { author: string; name: string; content: string }) =>
  request<Transcript>("/transcripts", { method: "POST", body: JSON.stringify(data) });

export const updateTranscript = (id: number, data: Partial<Transcript>) =>
  request<Transcript>(`/transcripts/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteTranscript = (id: number) =>
  request<void>(`/transcripts/${id}`, { method: "DELETE" });

// Strategies
export interface Strategy {
  id: number;
  name: string;
  description: string;
  source: string | null;
  author: string | null;
  params: Record<string, any> | null;
  enabled: boolean;
  backtestEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getStrategies = () => request<Strategy[]>("/strategies");

export const getEnabledStrategies = () => request<Strategy[]>("/strategies/enabled");

export const getStrategiesByAuthor = () =>
  request<Record<string, Strategy[]>>("/strategies/by-author");

export const createStrategy = (data: { name: string; description: string; source?: string; author?: string; params?: Record<string, any>; enabled?: boolean }) =>
  request<Strategy>("/strategies", { method: "POST", body: JSON.stringify(data) });

export const updateStrategy = (id: number, data: Partial<Strategy>) =>
  request<Strategy>(`/strategies/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const toggleStrategy = (id: number) =>
  request<Strategy>(`/strategies/${id}/toggle`, { method: "PATCH" });

export const toggleStrategyBacktest = (id: number) =>
  request<Strategy>(`/strategies/${id}/toggle-backtest`, { method: "PATCH" });

export const bulkSetEnabled = (enabled: boolean) =>
  request<Strategy[]>("/strategies/bulk-enabled", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

export const bulkSetBacktest = (backtestEnabled: boolean) =>
  request<Strategy[]>("/strategies/bulk-backtest", {
    method: "PATCH",
    body: JSON.stringify({ backtestEnabled }),
  });

export const deleteStrategy = (id: number) =>
  request<void>(`/strategies/${id}`, { method: "DELETE" });

// Gap Scanner
export interface GapScanResult {
  id: number;
  symbol: string;
  exchange: string | null;
  prevClose: number;
  currentPrice: number;
  gapPercent: number;
  preMarketVolume: number;
  ma20: number | null;
  ma200: number | null;
  trendDirection: string | null;
  dailyContext: string | null;
  score: number;
  scoreReasons: string[] | null;
  selected: boolean;
  scanDate: string;
  createdAt: string;
}

export const runGapScan = () =>
  request<GapScanResult[]>("/gap-scanner/scan", { method: "POST" });

export const getGapResults = (date?: string) => {
  const qs = date ? `?date=${date}` : "";
  return request<GapScanResult[]>(`/gap-scanner/results${qs}`);
};

export const toggleGapSelect = (id: number) =>
  request<GapScanResult>(`/gap-scanner/${id}/select`, { method: "PATCH" });

export const getSelectedGaps = () =>
  request<GapScanResult[]>("/gap-scanner/selected");

export const confirmGapSelection = () =>
  request<{ message: string; count: number }>("/gap-scanner/confirm", { method: "POST" });

// Settings
export interface Settings {
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLoss: number;
  currency: "GBP" | "USD";
  maxConcurrentTrades: number;
  dailyBudget: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  allowShortSelling: boolean;
  exchanges: string;
}

export const getSettings = () => request<Settings>("/settings");

// Historical gap scan
export const runHistoricalGapScan = (date: string, symbols?: string[]) =>
  request<GapScanResult[]>("/gap-scanner/scan/historical", {
    method: "POST",
    body: JSON.stringify({ date, symbols }),
  });

// Clear selected gaps
export const clearSelectedGaps = (date?: string) =>
  request<{ message: string }>("/gap-scanner/clear-selected", {
    method: "POST",
    body: JSON.stringify({ date }),
  });

// Per-author backtest result
export interface PerAuthorResult {
  stopLoss: number;
  takeProfit: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  finalEquity: number;
  entryMethod?: string;
  skippedStocks?: number;
  skippedReasons?: string[];
  explanation?: string;
}

// Backtest from gap scan results
export interface BacktestFromGapsResult {
  id: number;
  symbol: string;
  strategy: string;
  startDate: string;
  endDate: string;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  params: {
    scanDate: string;
    stopLossPercent: number;
    takeProfitPercent: number;
    startingCapital: number;
    finalEquity: number;
    trades: Array<{
      symbol: string;
      side: string;
      date: string;
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      pnlPercent: number;
      exitReason: string;
      gapPercent: number;
      shares: number;
      equityAfter: number;
    }>;
    optimalParams?: {
      stopLoss: number;
      takeProfit: number;
      totalPnl: number;
      winRate: number;
    };
    perAuthorResults?: Record<string, PerAuthorResult>;
  };
  createdAt: string;
}

export const runBacktestFromGaps = (params: {
  scanDate: string;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  startingCapital?: number;
}) =>
  request<BacktestFromGapsResult>("/backtest/run-from-gaps", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const updateSettings = (data: Settings) =>
  request<Settings>("/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Exchanges
export interface ExchangeInfo {
  exchanges: string[];
  counts: Record<string, number>;
}

export const getExchanges = () => request<ExchangeInfo>("/exchanges");

// Claude Strategy Optimiser
export interface ClaudeParams {
  swingLookback: number;
  waitBars: number;
  stopBuffer: number;
  rejectionThreshold: number;
}

export interface ClaudeOptimiseResult {
  bestParams: ClaudeParams;
  bestPnl: number;
  bestWinRate: number;
  bestTrades: number;
  allParamResults: Array<{
    params: ClaudeParams;
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
  }>;
  perDateBreakdown: Array<{
    scanDate: string;
    tradingDay: string;
    stocks: number;
    setupsBuilt: number;
    trades: number;
    pnl: number;
    winRate: number;
  }>;
  datesScanned: number;
  totalStocksAnalysed: number;
}

export const optimiseClaude = (startingCapital?: number) =>
  request<ClaudeOptimiseResult>("/backtest/optimise-claude", {
    method: "POST",
    body: JSON.stringify({ startingCapital }),
  });

// Emanuel Top Picks
export interface EmanuelPickTrade {
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  shares: number;
}

export interface EmanuelPick {
  symbol: string;
  gapPercent: number;
  score: number;
  scoreReasons: string[];
  dailyContext: string;
  trendDirection: string;
  ma20: number | null;
  ma200: number | null;
  trade: EmanuelPickTrade | null;
  skippedReason: string | null;
}

export interface EmanuelPicksDay {
  scanDate: string;
  tradingDay: string;
  picks: EmanuelPick[];
  dayPnl: number;
  dayTrades: number;
  dayWins: number;
}

export interface EmanuelPicksResult {
  days: EmanuelPicksDay[];
  totals: {
    totalPnl: number;
    totalTrades: number;
    totalWins: number;
    winRate: number;
    daysAnalysed: number;
    bestDay: { date: string; pnl: number } | null;
    worstDay: { date: string; pnl: number } | null;
  };
}

export const getEmanuelPicks = (endDate: string, startingCapital?: number) =>
  request<EmanuelPicksResult>("/backtest/emanuel-picks", {
    method: "POST",
    body: JSON.stringify({ endDate, startingCapital }),
  });
