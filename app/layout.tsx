import type { Metadata } from "next";
import { Big_Shoulders, Instrument_Sans, Josefin_Sans } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-display", display: "swap" });
const label = Josefin_Sans({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-label", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Sunrise Sunset Tap Co. · 8-tap beer truck hire, Perth",
  description: "Hire a tiny vintage tap truck for your wedding, party or event. Eight cold taps, delivered and collected anywhere from the Swan Valley to Mandurah.",
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
