import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import AppAudio from "@/components/AppAudio";

export const metadata: Metadata = {
  title: "Game Arena",
  description: "Play skill games on Celo. Wager G$ and win real rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)", minHeight: "100vh" }}>
        <Providers>
          {/* App-wide UI audio: ambient pad on menu routes + click blip on every
              button. Pauses during gameplay so game tracks dominate. */}
          <AppAudio />
          {children}
        </Providers>
      </body>
    </html>
  );
}
