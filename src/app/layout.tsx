import type { Metadata } from "next";
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
