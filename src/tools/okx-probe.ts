import { fetch } from "undici";
import { dispatcher } from "../lib/resolver.js";
const url = "https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=KES&baseCurrency=USDT&side=sell&paymentMethod=all&userType=all";
try {
  const res = await fetch(url, {
    dispatcher,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", Accept: "application/json" },
  });
  console.log("status", res.status);
  console.log((await res.text()).slice(0, 300));
} catch (e) {
  console.log("threw:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  const cause = (e as { cause?: unknown }).cause;
  if (cause) console.log("cause:", cause);
}
