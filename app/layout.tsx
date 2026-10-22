import type { Metadata } from "next";
import { Big_Shoulders, Instrument_Sans, Josefin_Sans } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import "./tokens.css";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-display", display: "swap" });
const label = Josefin_Sans({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-label", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Sunrise Sunset Tap Co. · 8-tap beer truck hire, Perth",
  description: "Hire a tiny vintage tap truck for your wedding, party or event. Eight cold taps, delivered and collected anywhere from the Swan Valley to Mandurah.",
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  openGraph: { type: "website", locale: "en_AU", siteName: "Sunrise Sunset Tap Co.", images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Lithograph of runners cresting a hill at dawn with the tap truck at the top" }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${display.variable} ${label.variable} ${body.variable}`}>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
