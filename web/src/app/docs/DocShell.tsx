import Link from "next/link";
import { docNeighbours } from "./nav";

/**
 * One documentation page: eyebrow, title, lead, body, and the links on to the
 * pages either side of it. Every page in /docs renders through this, so they
 * cannot drift apart typographically.
 */
export function DocShell({
  href,
  eyebrow = "DOCS",
  title,
  lead,
  children,
}: {
  href: string;
  eyebrow?: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  const { prev, next } = docNeighbours(href);

  return (
    <article className="doc-body">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="doc-title">{title}</h1>
      <p className="doc-lead">{lead}</p>

      {children}

      <nav className="doc-pager" aria-label="More documentation">
        {prev ? (
          <Link href={prev.href} className="doc-pager-link">
            <span>Previous</span>
            <b>{prev.label}</b>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={next.href} className="doc-pager-link next">
            <span>Next</span>
            <b>{next.label}</b>
          </Link>
        )}
      </nav>
    </article>
  );
}

/** A sub-heading inside a documentation page. */
export function H3({ children }: { children: React.ReactNode }) {
  return <h2 className="doc-h3">{children}</h2>;
}
