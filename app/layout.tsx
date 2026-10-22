import type { Metadata } from "next";
import { DM_Mono, Fraunces, Work_Sans } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "opsz"], variable: "--font-fraunces", display: "swap" });
const work = Work_Sans({ subsets: ["latin"], variable: "--font-work", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Sunrise Sunset Tap Co. · 8-tap beer truck hire, Perth",
  description: "Hire a tiny vintage tap truck for your wedding, party or event. Eight cold taps, delivered and collected anywhere from the Swan Valley to Mandurah.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${fraunces.variable} ${work.variable} ${mono.variable}`}>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
