import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import AppAudio from "@/components/AppAudio";

const APP_URL = "https://gamearenahq.xyz";
const APP_TITLE = "Game Arena";
const APP_TAGLINE = "Play free skill games on Celo. Top the weekly board, win real USDC.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_TITLE, template: `%s · ${APP_TITLE}` },
  description: APP_TAGLINE,
  applicationName: APP_TITLE,
  manifest: "/manifest.webmanifest",
  // Icon set lives in /public — favicon for tabs, apple-touch-icon for
  // iOS home-screen, plus 192/512 PNGs the manifest pulls for PWA installs.
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Apple web-app meta — when a MiniPay / iOS user adds the app to home
  // screen it launches full-screen with a dark translucent status bar so
  // the gradient bg flows edge-to-edge.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_TITLE,
  },
  // OpenGraph + Twitter — the cards that render when gamearenahq.xyz is
  // shared in WhatsApp, X, Telegram, Discord, etc. Uses the proper 1200x630
  // banner so previews look like a finished product, not a stretched logo.
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: APP_TITLE,
    title: APP_TITLE,
    description: APP_TAGLINE,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: APP_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_TITLE,
    description: APP_TAGLINE,
    images: ["/og-image.png"],
  },
};

// Viewport exports are required by the Next 16 metadata API. Opera MiniPay
// reads them when deciding how to render the app inside its webview. The
// Celo MiniPay reference recommends a 360x640 test viewport; width=device-
// width + initialScale=1 matches that.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6a18c8",
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
