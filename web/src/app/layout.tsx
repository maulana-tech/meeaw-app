import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { jetbrainsMono, urbanist } from "../components/landing/fonts";
import { PrivyAppProvider } from "../components/PrivyAppProvider";
import { Toaster } from "../components/ui/sonner";
import { WalletProvider } from "../components/WalletProvider";
import { ServiceWorkerRegistration } from "../features/pwa/ServiceWorkerRegistration";
import { TRPCReactProvider } from "../trpc/react";

export const metadata: Metadata = {
  title: "Meaw: private USDC payments",
  description:
    "Confidential USDC payment links on Monad. Private by default, provable on demand.",
  appleWebApp: { capable: true, title: "Meaw", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`min-h-full font-sans ${urbanist.variable} ${jetbrainsMono.variable}`}
      // The dashboard sets data-dash-mode before hydration to avoid a flash.
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground antialiased font-sans">
        <ServiceWorkerRegistration />
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-lg bg-panel px-4 py-2 text-sm font-semibold text-ink shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to main content
        </a>
        <PrivyAppProvider>
          <TRPCReactProvider>
            <WalletProvider>
              <AppShell>{children}</AppShell>
            </WalletProvider>
          </TRPCReactProvider>
        </PrivyAppProvider>
        <Toaster />
      </body>
    </html>
  );
}
