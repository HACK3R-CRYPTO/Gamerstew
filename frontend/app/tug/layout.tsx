import type { Metadata } from "next";

// Share card for the event.
//
// This serves the static 140KB JPG rather than generating one with
// ImageResponse. ImageResponse only emits PNG, and the card it produced came
// out at 1.36MB — WhatsApp silently drops previews above roughly 250KB, which
// is exactly the channel this event will spread through. Baking the headline
// into the image is redundant anyway: every preview surface renders og:title
// and og:description as real text beside the art, so the words cost nothing
// there and would cost kilobytes here.
//
// 1200x630 also satisfies X's 1200x628, so one asset covers both.
const OG = "/tug/og.jpg";

export const metadata: Metadata = {
  title: "Tug of War · 1,000,000 G$",
  description:
    "Two sides, seven days, one rope. Every verified human on your side pulls. First 160 verified players get 2,500 G$ guaranteed.",
  openGraph: {
    type: "website",
    title: "GameArena Tug of War · 1,000,000 G$",
    description: "Two sides. Seven days. One rope. Pick a side and pull.",
    images: [{ url: OG, width: 1200, height: 630, alt: "Two teams of slimes pulling a rope for 1,000,000 G$" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GameArena Tug of War · 1,000,000 G$",
    description: "Two sides. Seven days. One rope. Pick a side and pull.",
    images: [OG],
  },
};

export default function TugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
