import { SiteTop } from "@/components/SiteTop";
import { Footer } from "@/components/Footer";
import { DocsNav } from "./DocsNav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main">
      <SiteTop />
      <div className="doc">
        <DocsNav />
        {children}
      </div>
      <Footer />
    </main>
  );
}
