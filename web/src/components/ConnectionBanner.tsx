"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/live";

/**
 * Whether the app can still reach anything.
 *
 * Until now a dropped connection looked like a slow app. Prices stopped
 * moving, the chart kept its last candles, and the order ticket still took a
 * size and offered to send it — because nothing on screen knew the network
 * had gone. On the connections this product is built for, that is a state
 * people are in regularly, not an edge case.
 *
 * Two signals, and they answer different questions. The browser's own
 * `online` flag says whether there is a network at all; it is reliable when
 * false and close to meaningless when true — a captive portal, a dead router
 * or an asleep phone all report online. So the second signal is our own:
 * consecutive failures from the price poller, which is the thing that is
 * actually trying to reach us every thirty seconds.
 */
export function ConnectionBanner() {
  const { failures, error, at, refresh } = useLive();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = (): void => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // One failure is a blip and should not shout. Two in a row, with the
  // backoff between them, is a pattern.
  const unreachable = failures >= 2;
  if (!offline && !unreachable) return null;

  const since = at ? new Date(at).toLocaleTimeString() : null;

  return (
    <div className={`app-banner is-${offline ? "offline" : "unreachable"}`} role="status">
      <span>
        <b>{offline ? "You are offline." : "We cannot reach Parallel."}</b>{" "}
        {since
          ? `Prices are from ${since} and are not updating.`
          : "No prices have loaded yet."}{" "}
        {offline
          ? "Positions already open are safe on-chain — nothing depends on this page staying connected."
          : error
            ? `Last attempt: ${error}.`
            : "Retrying automatically."}
      </span>
      <button type="button" className="closebtn" onClick={refresh}>
        Try now
      </button>
    </div>
  );
}
