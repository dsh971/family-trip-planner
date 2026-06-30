import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "@sumiui/react/styles";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "FamTripPlanner",
  description: "Tokyo family trip planner",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cormorant.variable} h-full antialiased`}
    >
      <head>
        <style>{`
          :root {
            --font-body: var(--font-inter), -apple-system, BlinkMacSystemFont, sans-serif;
            --font-display: var(--font-cormorant), Georgia, serif;
          }
        `}</style>
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
