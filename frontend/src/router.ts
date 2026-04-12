import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { tradesRoute } from "./routes/trades";
import { watchlistRoute } from "./routes/watchlist";
import { backtestRoute } from "./routes/backtest";
import { capitolTradesRoute } from "./routes/capitol-trades";
import { transcriptsRoute } from "./routes/transcripts";
import { strategiesRoute } from "./routes/strategies";
import { settingsRoute } from "./routes/settings";
import { gapScannerRoute } from "./routes/gap-scanner";

const routeTree = rootRoute.addChildren([
  indexRoute,
  tradesRoute,
  watchlistRoute,
  strategiesRoute,
  backtestRoute,
  capitolTradesRoute,
  transcriptsRoute,
  settingsRoute,
  gapScannerRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
