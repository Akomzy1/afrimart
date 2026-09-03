import type { Metadata, Viewport } from "next";
import "@afrimart/ui/global.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AfriMart Merchant",
  description: "Film your shelves, accept orders, pack, print the label.",
  manifest: "/manifest.json",
};

// Mobile-only per CLAUDE.md merchant-simplicity principle — no desktop layout.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
