import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import { SplashScreen } from "@/components/SplashScreen";
// Plus Jakarta Sans, self-hosted — a clean geometric sans with real character.
// Bundled with the app (no Google Fonts fetch), so it renders everywhere.
import "@fontsource-variable/plus-jakarta-sans";
// Battambang — proper Khmer typeface for price labels (bold headline weights).
import "@fontsource/battambang/400.css";
import "@fontsource/battambang/700.css";
import "@fontsource/battambang/900.css";
// Kantumruy Pro — the Khmer typeface for the customer screen (400 + 700 Bold).
import "@fontsource/kantumruy-pro/400.css";
import "@fontsource/kantumruy-pro/700.css";
// The rest of the customer-board typefaces (see lib/boardFonts). Bundled rather
// than fetched: a TV on shop wifi must not wait on a font server to draw the
// number someone is queueing for. Only the weights the board can actually use —
// Koulen and Moul ship one weight each, so asking for more would be a synthesised
// bold that smears Khmer diacritics.
import "@fontsource/hanuman/400.css";
import "@fontsource/hanuman/700.css";
import "@fontsource/hanuman/900.css";
import "@fontsource/nokora/400.css";
import "@fontsource/nokora/700.css";
import "@fontsource/nokora/900.css";
import "@fontsource/koulen/400.css";
import "@fontsource/moul/400.css";
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
        <SplashScreen />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
