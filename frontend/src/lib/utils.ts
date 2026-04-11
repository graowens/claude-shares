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
