/** Probe a candidate P2P endpoint and print enough of the body to parse it. */
import { fetch } from "undici";
import { dispatcher } from "../lib/resolver.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function probe(name: string, url: string, init?: { method?: string; body?: string }) {
  try {
    const res = await fetch(url, {
      dispatcher,
      method: init?.method ?? "GET",
      body: init?.body,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const text = await res.text();
    console.log(`\n=== ${name} :: HTTP ${res.status}`);
    console.log(text.slice(0, 420));
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    console.log(`\n=== ${name} :: FAIL ${cause?.code ?? ""} ${cause?.message ?? (e as Error).message}`);
  }
}

await probe("bybit p2p KES", "https://api2.bybit.com/fiat/otc/item/online", {
  method: "POST",
  body: JSON.stringify({ tokenId: "USDT", currencyId: "KES", side: "1", page: "1", size: "5" }),
});
await probe("bitget p2p KES", "https://www.bitget.com/v1/p2p/pub/adv/queryAdvList?side=sell&fiat=KES&coin=USDT&pageNo=1&pageSize=5");
await probe("kucoin p2p KES", "https://www.kucoin.com/_api/otc/ad/list?currency=KES&side=SELL&legal=KES&page=1&pageSize=5");
