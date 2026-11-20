import { AppShell } from "@/components/AppShell";

/** The demo store and toasts live in the root layout, shared with /signin. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
