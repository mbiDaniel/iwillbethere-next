import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { MockProvider } from "@/components/store";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import "./studio.css";

const display = localFont({
  src: "../public/display.woff2",
  variable: "--display",
  weight: "400 700",
});

const body = localFont({
  src: "../public/body.woff2",
  variable: "--body",
  weight: "400 900",
});

export const metadata: Metadata = {
  title: "I Will Be There — Personalized event flyers",
  description:
    "Turn your event artwork into personalized flyers for every guest.",
  icons: { icon: "/brand.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`light ${display.variable} ${body.variable}`}>
      <body className="antialiased">
        <QueryProvider>
          <MockProvider>{children}</MockProvider>
        </QueryProvider>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
