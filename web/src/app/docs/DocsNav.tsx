"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOC_GROUPS } from "./nav";

/** The docs sidebar, with the page you are on marked. */
export function DocsNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className={`doc-nav${open ? " open" : ""}`} aria-label="Documentation">
      {/* On a phone the whole sidebar collapses behind the current page's name. */}
      <button
        type="button"
        className="doc-nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Documentation
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className="doc-nav-list">
        {DOC_GROUPS.map((g) => (
          <div key={g.title} className="doc-nav-group">
            <div className="doc-nav-title">{g.title.toUpperCase()}</div>
            {g.pages.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={p.href === path ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {p.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
