import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/styles/design.css";
import { ToastProvider } from "@/components/Toast";
import { LiveProvider } from "@/lib/live";
import { FormatProvider } from "@/lib/format-provider";

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Parallel — trade the parallel rate",
  description:
    "Long or short the dollar against the naira, the peso, the rupee and more. " +
    "Priced from the street rate people actually pay. Devnet beta on Solana.",
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <a href="#main" className="sr-only">
          Skip to content
        </a>
        {/* Only two providers at the root, and both are cheap.
            `LiveProvider` lays the real index over the sample data, so every
            screen — including the landing table — shows live prices.
            Everything to do with wallets lives in `<WalletStack>`, mounted by
            /app and /signin, because the Privy SDK is most of the
            JavaScript on this site and the docs do not need it. */}
        {/* LiveProvider sits *outside* FormatProvider on purpose. Changing
            the number format remounts everything below it, and if the price
            state were inside that subtree it would be thrown away too — the
            board would blink back to "Sample data" and refetch, for a change
            of decimal separator. */}
        <LiveProvider>
          <FormatProvider>
            <ToastProvider>{children}</ToastProvider>
          </FormatProvider>
        </LiveProvider>
      </body>
    </html>
  );
}
