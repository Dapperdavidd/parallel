import { Suspense } from "react";
import { TradeView } from "@/components/trade/TradeView";

export default function TradePage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: "var(--ink3)" }}>Loading market…</div>}>
      <TradeView />
    </Suspense>
  );
}
