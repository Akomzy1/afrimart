import type { Metadata, Viewport } from "next";
import "@afrimart/ui/global.css";
import "./globals.css";
import { Providers } from "./providers";
import { ToastProvider } from "@afrimart/ui";
import { CartProvider } from "./cart-context";
import { BuyerChrome } from "./buyer-chrome";

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
        <Providers>
          <ToastProvider>
            <CartProvider>
              <div className="app-shell">
                <div className="app-scroll">{children}</div>
                <BuyerChrome />
              </div>
            </CartProvider>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
