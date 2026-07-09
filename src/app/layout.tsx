import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

// Inter — clean, modern, professional. Loads on the deployed app; falls back to
// the native system font where webfonts can't be fetched.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Stookii — ON Mart Retail Ordering",
  description: "Purchase requests, purchase orders, goods receiving & stock for ON Mart.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
