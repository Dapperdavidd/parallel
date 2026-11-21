"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand";
import { DOC_GROUPS } from "@/app/docs/nav";

/**
 * Landing nav: mark on the left, links centred, sign-in on the right.
 *
 * "Markets" and "Product" scroll the page. "Trade" goes straight into the app
 * — no sign-in required to look around; the app shows "Connect" until you
 * actually need a wallet. "Docs" opens a menu, because there are two quite
 * different things under it: the plain-English guide and the reference.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
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

  return (
    <header className="lnav">
      <nav aria-label="Main">
        <Brand />
        <div className="navpill">
          <Link href="/#markets">Markets</Link>
          <Link href="/#features">Product</Link>
          <Link href="/app/trade">Trade</Link>

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
          <Link href="/signin" className="btn btn-light" style={{ height: 42 }}>
            Sign in / Sign up
          </Link>
        </div>
      </nav>
    </header>
  );
}
