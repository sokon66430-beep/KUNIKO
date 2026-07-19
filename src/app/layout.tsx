import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
// Plus Jakarta Sans, self-hosted — a clean geometric sans with real character.
// Bundled with the app (no Google Fonts fetch), so it renders everywhere.
import "@fontsource-variable/plus-jakarta-sans";
// Battambang — proper Khmer typeface for price labels (bold headline weights).
import "@fontsource/battambang/400.css";
import "@fontsource/battambang/700.css";
import "@fontsource/battambang/900.css";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Stookii — ON Mart Retail Ordering",
  description: "Purchase requests, purchase orders, goods receiving & stock for ON Mart.",
  applicationName: "Stookii",
  // Lets iOS treat the installed app like a native one (full-screen, own title).
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Stookii" },
  formatDetection: { telephone: false },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#2549e8",
  width: "device-width",
  initialScale: 1,
  // A till shouldn't zoom/pan under a fat finger.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
