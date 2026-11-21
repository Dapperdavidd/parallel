/**
 * The documentation map. One source of truth: the sidebar, the previous/next
 * footer links and the nav dropdown all read from here, so a page can never
 * exist without a way to reach it.
 */

export interface DocPageMeta {
  href: string;
  label: string;
  /** Shown in the dropdown and on the docs index. */
  blurb: string;
}

export interface DocGroup {
  title: string;
  pages: DocPageMeta[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    title: "Learning",
    pages: [
      { href: "/docs", label: "Start here", blurb: "Two prices, and what Parallel does with them." },
      { href: "/docs/prices", label: "Where the price comes from", blurb: "The street-rate index, step by step." },
      { href: "/docs/trading", label: "How trading works", blurb: "Perpetuals, long and short, leverage, liquidation, funding." },
      { href: "/docs/hedging", label: "How hedging works", blurb: "Protecting savings you already hold." },
      { href: "/docs/app", label: "A tour of the app", blurb: "What each screen does, and where your wallet comes from." },
      { href: "/docs/risks", label: "Risks", blurb: "What can go wrong, stated plainly." },
      { href: "/docs/faq", label: "Common questions", blurb: "Short answers to the things people ask first." },
      { href: "/docs/about", label: "About Parallel", blurb: "Why this exists and what it runs on." },
    ],
  },
  {
    title: "Reference",
    pages: [
      { href: "/docs/api", label: "API documentation", blurb: "Index feed, market data and on-chain addresses." },
    ],
  },
];

export const DOC_PAGES: DocPageMeta[] = DOC_GROUPS.flatMap((g) => g.pages);

/** The page before and after `href` in reading order. */
export function docNeighbours(href: string): {
  prev: DocPageMeta | null;
  next: DocPageMeta | null;
} {
  const i = DOC_PAGES.findIndex((p) => p.href === href);
  if (i === -1) return { prev: null, next: null };
  return { prev: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}
