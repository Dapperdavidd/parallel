/**
 * Which way round a number is written.
 *
 * A million and a half is `1,500,000.00` in Lagos and Mumbai, `1.500.000,00`
 * in São Paulo, and `1 500 000,00` in much of francophone West Africa. For a
 * product whose whole audience is outside the places that write it the first
 * way, defaulting to en-US and calling it done is a small daily insult.
 *
 * The app bar had a picker for exactly this. It set a piece of React state
 * and nothing else — three formats offered, none applied. This makes it real.
 *
 * It is a module-level setting rather than a context because `fmt` is a plain
 * function called from about ninety places, and threading a hook through all
 * of them to serve a preference somebody changes roughly never would be the
 * wrong trade. Changing it remounts the tree (see `FormatProvider`), which is
 * cheap for a deliberate, rare action and makes every existing call correct
 * without touching one of them.
 */

export interface NumberStyle {
  /** What the menu shows. */
  readonly sample: string;
  /** A real BCP 47 tag, because `Intl` does the work, not a lookup table. */
  readonly locale: string;
  readonly label: string;
}

export const NUMBER_STYLES: readonly NumberStyle[] = [
  { sample: "1,234.56", locale: "en-US", label: "Comma thousands, full stop decimal" },
  { sample: "1.234,56", locale: "de-DE", label: "Full stop thousands, comma decimal" },
  { sample: "1 234,56", locale: "fr-FR", label: "Space thousands, comma decimal" },
  { sample: "1 234.56", locale: "en-ZA", label: "Space thousands, full stop decimal" },
];

const KEY = "parallel.numberFormat.v1";
const DEFAULT = NUMBER_STYLES[0]!;

let current: NumberStyle = DEFAULT;
let loaded = false;

/** Read once, lazily: the first `fmt` call happens before any effect runs. */
function ensure(): NumberStyle {
  if (loaded || typeof window === "undefined") return current;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    const found = NUMBER_STYLES.find((style) => style.locale === saved);
    if (found) current = found;
  } catch {
    /* private mode: the default is fine */
  }
  return current;
}

export const numberStyle = (): NumberStyle => ensure();

export function setNumberStyle(locale: string): void {
  const found = NUMBER_STYLES.find((style) => style.locale === locale);
  if (!found) return;
  current = found;
  loaded = true;
  try {
    window.localStorage.setItem(KEY, locale);
  } catch {
    /* the choice still holds for this session */
  }
}

/**
 * The server renders with the default and the client may prefer another, so
 * the first client render must match the server's or React will complain and
 * patch it noisily. `FormatProvider` remounts the tree after hydration
 * instead, which is why this exists.
 */
export const defaultStyle = (): NumberStyle => DEFAULT;
