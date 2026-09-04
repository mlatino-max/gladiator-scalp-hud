import type { Metadata } from "next";
import "./globals.css";
import { HudProvider } from "@/components/HudProvider";
import { AppShell } from "@/components/Shell";
import { EvidenceProvider } from "@/components/evidence";

export const metadata: Metadata = {
  title: "GLADIATOR SCALP // COMMAND HUD",
  description: "Four-floor trading command deck + evidence dashboard. Observes and gates. Never places an order.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;800&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
      </head>
      <body>
        <HudProvider>
          <EvidenceProvider>
            <AppShell>{children}</AppShell>
          </EvidenceProvider>
        </HudProvider>
      </body>
    </html>
  );
}
