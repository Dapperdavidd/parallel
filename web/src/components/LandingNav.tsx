"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand";
import { DOC_GROUPS } from "@/app/docs/nav";

const LINKS: [string, string][] = [
  ["/#markets", "Markets"],
  ["/#features", "Product"],
  ["/app/trade", "Trade"],
];

/**
 * Routes we do not prefetch.
 *
 * Next fetches a linked route's JavaScript when the link enters the viewport.
 * "Trade" and "Sign in" sit in the header of every marketing and
 * documentation page, and both lead into the app — so reading the FAQ pulled
 * down the Privy SDK, the Solana kit and the wallet connectors, which is most
 * of the JavaScript on this site, for a page made of prose.
 *
 * The cost of turning it off is a slower first click, paid only by people who
 * click. The cost of leaving it on is paid by everybody, on the connections
 * this product exists for.
 */
const heavy = (href: string): boolean => href.startsWith("/app") || href.startsWith("/signin");

/**
 * Landing nav: mark on the left, links centred, sign-in on the right.
 *
 * "Markets" and "Product" scroll the page. "Trade" goes straight into the app
 * — no sign-in required to look around; the app shows "Connect" until you
 * actually need a wallet. "Docs" opens a menu, because there are two quite
 * different things under it: the plain-English guide and the reference.
 *
 * Below 860px the centred pill does not fit, so the same links move into a
 * sheet behind a burger. The sign-in button stays in the bar either way —
 * it is the one thing a visitor should never have to open a menu to find.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on a click elsewhere or on Escape — a menu you cannot dismiss is a
  // trap, especially on a page that scrolls.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("mousedown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousedown", onDown);
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The sheet covers the page, so the page behind it must not scroll, and
  // Escape must get you out.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSheet(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  // A viewport that grows past the breakpoint while the sheet is open would
  // leave it stranded over the desktop layout.
  useEffect(() => {
    const mq = window.matchMedia("(min-width:861px)");
    const onChange = (): void => {
      if (mq.matches) setSheet(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header className={`lnav${sheet ? " sheet-open" : ""}`}>
      <nav aria-label="Main">
        <Brand />

        <div className="navpill">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} prefetch={heavy(href) ? false : undefined}>
              {label}
            </Link>
          ))}

          <div className="navdrop" ref={wrap}>
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="true"
              onClick={() => setOpen((v) => !v)}
            >
              Docs
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
                style={{ transform: open ? "rotate(180deg)" : undefined, transition: ".18s" }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {open && (
              <div className="navdrop-menu">
                {DOC_GROUPS.map((g) => {
                  // One entry per group: the group's own landing page, not
                  // eight links the reader has to triage before they start.
                  const first = g.pages[0]!;
                  return (
                    <Link key={g.title} href={first.href} onClick={() => setOpen(false)}>
                      <b>{g.title === "Learning" ? "Learning" : "API documentation"}</b>
                      <span>
                        {g.title === "Learning"
                          ? "How prices, trading and hedging work, in plain English."
                          : first.blurb}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="nav-right">
          <button
            type="button"
            className="navburger"
            aria-expanded={sheet}
            aria-controls="nav-sheet"
            aria-label={sheet ? "Close menu" : "Open menu"}
            onClick={() => setSheet((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              {sheet ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>

          <Link href="/signin" prefetch={false} className="btn btn-light" style={{ height: 42 }}>
            Sign in / Sign up
          </Link>
        </div>
      </nav>

      {sheet && (
        <div className="navsheet" id="nav-sheet">
          <div className="navsheet-inner">
            {LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                prefetch={heavy(href) ? false : undefined}
                onClick={() => setSheet(false)}
              >
                {label}
              </Link>
            ))}

            {DOC_GROUPS.map((g) => (
              <div key={g.title} className="navsheet-group">
                <div className="doc-nav-title">{g.title.toUpperCase()}</div>
                {g.pages.map((p) => (
                  <Link key={p.href} href={p.href} onClick={() => setSheet(false)}>
                    {p.label}
                  </Link>
                ))}
              </div>
            ))}

            <div className="navsheet-group">
              <div className="doc-nav-title">MORE</div>
              <Link href="/open-index" onClick={() => setSheet(false)}>
                Open index
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
