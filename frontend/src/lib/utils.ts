import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency: "USD" | "GBP" = "USD"
): string {
  const symbol = currency === "GBP" ? "\u00a3" : "$";
  const formatted = Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export type MarketStatus = "open" | "closed" | "pre-market";

export function getMarketStatus(): MarketStatus {
  const now = new Date();
  const ukHour = now.getUTCHours() + (isBST(now) ? 1 : 0);
  const ukMinute = now.getUTCMinutes();
  const ukTime = ukHour * 60 + ukMinute;
  const day = now.getUTCDay();

  // Weekends
  if (day === 0 || day === 6) return "closed";

  // NYSE: 14:30 - 21:00 UK time
  const open = 14 * 60 + 30; // 14:30
  const close = 21 * 60; // 21:00
  const preMarketStart = 10 * 60; // 10:00 UK (pre-market 04:00 ET)

  if (ukTime >= open && ukTime < close) return "open";
  if (ukTime >= preMarketStart && ukTime < open) return "pre-market";
  return "closed";
}

function isBST(date: Date): boolean {
  // Simple BST check: last Sunday of March to last Sunday of October
  const year = date.getUTCFullYear();
  const marchLast = new Date(Date.UTC(year, 2, 31));
  const bstStart = new Date(
    Date.UTC(year, 2, 31 - marchLast.getUTCDay(), 1, 0)
  );
  const octLast = new Date(Date.UTC(year, 9, 31));
  const bstEnd = new Date(
    Date.UTC(year, 9, 31 - octLast.getUTCDay(), 1, 0)
  );
  return date >= bstStart && date < bstEnd;
}

export function plClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted-foreground";
}

export function exchangeColor(exchange: string | null | undefined): string {
  switch (exchange?.toUpperCase()) {
    case 'NASDAQ': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'NYSE': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'ARCA': return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
    case 'BATS': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    case 'OTC': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
    case 'AMEX': return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
    case 'CRYPTO': return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
    default: return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
  }
}
