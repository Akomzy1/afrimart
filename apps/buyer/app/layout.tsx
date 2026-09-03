import type { Metadata, Viewport } from "next";
import "@afrimart/ui/global.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AfriMart — The market from home, delivered",
  description: "African groceries from verified stores and home sellers, shipped nationwide.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
