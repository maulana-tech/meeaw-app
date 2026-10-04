import { JetBrains_Mono, Urbanist } from "next/font/google";

// Scoped to the landing page (applied on its root in Chrome), so the product
// UI keeps its own typography.
export const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-urbanist",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
