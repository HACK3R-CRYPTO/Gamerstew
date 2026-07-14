import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import AppAudio from "@/components/AppAudio";

const APP_URL = "https://gamearenahq.xyz";
const APP_TITLE = "Game Arena";
// Homepage/browser-tab title · keyword-rich so it ranks and reads clearly
// in search results. Sub-pages get "<Page> · Game Arena" via the template.
const APP_TITLE_FULL = "Game Arena · Quick Games That Make You Sharper";
// Meta description · what shows under the title in Google and in link
// previews. Leads with the human benefit and the terms people search for
// (brain games, memory, focus, reflexes), free-first, money as a bonus.
const APP_TAGLINE = "Free quick games that make you sharper. Train your memory, focus and reflexes, play real people, and earn real rewards. Live on Celo, in your browser or MiniPay.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_TITLE_FULL, template: `%s · ${APP_TITLE}` },
  description: APP_TAGLINE,
  applicationName: APP_TITLE,
  keywords: [
    "brain games", "memory game", "skill games", "reflex games", "quick games",
    "free online games", "puzzle games", "compete online", "leaderboard games",
    "Game Arena", "Celo games", "MiniPay games", "play and earn", "verified players",
  ],
  category: "games",
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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: APP_TITLE,
    title: APP_TITLE_FULL,
    description: APP_TAGLINE,
    locale: "en_US",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Game Arena · quick games that make you sharper" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@Gamearenahq",
    creator: "@Gamearenahq",
    title: APP_TITLE_FULL,
    description: APP_TAGLINE,
    images: ["/og-image.png"],
  },
  // Domain-ownership proof for talentapp (the GoodBuilders /
  // GoodDollar talent / FlowState surface). Renders as a raw
  // <meta name="talentapp:project_verification" content="..."> in the
  // <head> of every page including the homepage, which is what their
  // verifier scans for.
  verification: {
    other: {
      "talentapp:project_verification":
        "33629443ae7805f6f5c5b27a14b89553b7e12b36d74d19a7f1a31b9c8051174cc23b1ecf110ec57179a35c0c484bd0c301f2623c33c56af8548aa0fc4bb4f1e2",
    },
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
      <head>
        {/* Preload the splash logo — it's the LCP element on the root route.
            Starting its fetch in <head> (before the JS bundle parses and React
            mounts) is the single biggest LCP win: the bytes are ready by the
            time the splash component paints it. */}
        <link rel="preload" as="image" href="/logo-full.png" fetchPriority="high" />
        {/* Structured data (JSON-LD) — tells Google this is a game web app
            from an organization, wires the sitelinks search box, and lets the
            homepage qualify for richer search results. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Person",
                  "@id": `${APP_URL}/#founder`,
                  name: "ogazboiz",
                  jobTitle: "Founder & Developer",
                  url: APP_URL,
                },
                {
                  "@type": "Organization",
                  "@id": `${APP_URL}/#org`,
                  name: APP_TITLE,
                  url: APP_URL,
                  logo: `${APP_URL}/logo-full.png`,
                  founder: { "@id": `${APP_URL}/#founder` },
                  sameAs: ["https://x.com/Gamearenahq", "https://t.me/gamearenaHQ"],
                },
                {
                  "@type": "WebSite",
                  "@id": `${APP_URL}/#website`,
                  name: APP_TITLE,
                  url: APP_URL,
                  publisher: { "@id": `${APP_URL}/#org` },
                  potentialAction: {
                    "@type": "SearchAction",
                    target: `${APP_URL}/games?q={search_term_string}`,
                    "query-input": "required name=search_term_string",
                  },
                },
                {
                  "@type": "WebApplication",
                  name: APP_TITLE,
                  url: APP_URL,
                  applicationCategory: "GameApplication",
                  operatingSystem: "Web, iOS, Android",
                  description: APP_TAGLINE,
                  author: { "@id": `${APP_URL}/#founder` },
                  creator: { "@id": `${APP_URL}/#founder` },
                  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                },
              ],
            }),
          }}
        />
      </head>
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
