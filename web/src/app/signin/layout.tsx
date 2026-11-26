import { WalletStack } from "@/components/WalletStack";

/**
 * Sign-in needs a wallet, and it is the only page outside /app that does.
 *
 * Mounting the stack here rather than at the root is what keeps the Privy SDK
 * off the landing page and the documentation.
 */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <WalletStack>{children}</WalletStack>;
}
