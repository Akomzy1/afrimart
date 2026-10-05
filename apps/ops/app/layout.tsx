import type { Metadata } from "next";
import "@afrimart/ui/global.css";
import "./ops.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AfriMart Operations",
  description: "Internal console: catalogue review, onboarding, fulfilment and reconciliation.",
  robots: { index: false, follow: false },
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
