"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

const loadingTexts = [
  ">> INITIALIZING_GAME_ARENA...",
">> CONNECTING_TO_CELO_MAINNET...,",
">> LOADING_G$_PROTOCOL...",
">> READY_TO_PLAY..._"
]

const LOADING_TEXT_CHANGE_TIME = 1800;

const LEFT_ICONS: {
  src: string;
  top: string;
  left: string;
  size: number;
  delay: number;
  dur: number;
  glow: string;
  rotate: number;
}[] = [
  {
    src: D,
    top: "1%",
    left: "-18px",
    size: 120,
    delay: 0.0,
    dur: 5.2,
    glow: "#cc44ff",
    rotate: -18,
  },
  {
    src: M,
    top: "8%",
    left: "34px",
    size: 80,
    delay: 0.7,
    dur: 4.3,
    glow: "#ffaa00",
    rotate: 12,
  },
  {
    src: M,
    top: "14%",
    left: "62px",
    size: 70,
    delay: 1.1,
    dur: 3.9,
    glow: "#ffaa00",
    rotate: -10,
  },
  {
    src: G,
    top: "24%",
    left: "6px",
    size: 110,
    delay: 1.4,
    dur: 6.0,
    glow: "#aa88ff",
    rotate: -6,
  },
  {
    src: D,
    top: "36%",
    left: "72px",
    size: 140,
    delay: 0.3,
    dur: 4.8,
    glow: "#cc44ff",
    rotate: 16,
  },
  {
    src: J,
    top: "46%",
    left: "-10px",
    size: 105,
    delay: 2.1,
    dur: 5.5,
    glow: "#22aaff",
    rotate: -8,
  },
  {
    src: M,
    top: "54%",
    left: "48px",
    size: 85,
    delay: 1.0,
    dur: 4.2,
    glow: "#ffaa00",
    rotate: 18,
  },
  {
    src: M,
    top: "60%",
    left: "76px",
    size: 72,
    delay: 1.6,
    dur: 3.7,
    glow: "#ffaa00",
    rotate: -5,
  },
  {
    src: G,
    top: "68%",
    left: "4px",
    size: 108,
    delay: 2.8,
    dur: 5.0,
    glow: "#aa88ff",
    rotate: -14,
  },
  {
    src: D,
    top: "78%",
    left: "80px",
    size: 95,
    delay: 1.9,
    dur: 4.6,
    glow: "#cc44ff",
    rotate: 10,
  },
  {
    src: J,
    top: "89%",
    left: "-16px",
    size: 102,
    delay: 3.2,
    dur: 5.8,
    glow: "#22aaff",
    rotate: -20,
  },
];

const RIGHT_ICONS: {
  src: string;
  top: string;
  right: string;
  size: number;
  delay: number;
  dur: number;
  glow: string;
  rotate: number;
}[] = [
  {
    src: D,
    top: "0%",
    right: "-22px",
    size: 115,
    delay: 0.4,
    dur: 5.0,
    glow: "#cc44ff",
    rotate: 20,
  },
  {
    src: D,
    top: "7%",
    right: "12px",
    size: 95,
    delay: 0.9,
    dur: 4.4,
    glow: "#cc44ff",
    rotate: -12,
  },
  {
    src: J,
    top: "16%",
    right: "54px",
    size: 100,
    delay: 1.2,
    dur: 4.8,
    glow: "#22aaff",
    rotate: 8,
  },
  {
    src: V,
    top: "27%",
    right: "0px",
    size: 120,
    delay: 2.0,
    dur: 6.2,
    glow: "#ff44cc",
    rotate: -4,
  },
  {
    src: D,
    top: "38%",
    right: "-14px",
    size: 98,
    delay: 1.5,
    dur: 4.5,
    glow: "#cc44ff",
    rotate: 14,
  },
  {
    src: M,
    top: "47%",
    right: "44px",
    size: 82,
    delay: 0.6,
    dur: 4.0,
    glow: "#ffaa00",
    rotate: -16,
  },
  {
    src: M,
    top: "54%",
    right: "70px",
    size: 72,
    delay: 1.3,
    dur: 3.8,
    glow: "#ffaa00",
    rotate: 6,
  },
  {
    src: D,
    top: "63%",
    right: "-8px",
    size: 100,
    delay: 2.4,
    dur: 5.2,
    glow: "#cc44ff",
    rotate: 10,
  },
  {
    src: G,
    top: "73%",
    right: "58px",
    size: 108,
    delay: 1.8,
    dur: 5.8,
    glow: "#aa88ff",
    rotate: -10,
  },
  {
    src: J,
    top: "84%",
    right: "10px",
    size: 100,
    delay: 3.0,
    dur: 4.6,
    glow: "#22aaff",
    rotate: 18,
  },
];

const DOTS: {
  top: string;
  left: string;
  color: string;
  size: number;
  delay: number;
  dur: number;
}[] = [
  { top: "7%", left: "44%", color: "#ff69b4", size: 13, delay: 0.0, dur: 3.5 },
  { top: "14%", left: "37%", color: "#00d4a8", size: 7, delay: 0.8, dur: 2.8 },
  { top: "21%", left: "58%", color: "#ff8c00", size: 10, delay: 1.5, dur: 4.0 },
  { top: "29%", left: "50%", color: "#ff00cc", size: 5, delay: 0.3, dur: 3.2 },
  { top: "36%", left: "63%", color: "#00e5ff", size: 8, delay: 1.2, dur: 2.5 },
  { top: "43%", left: "34%", color: "#ff4488", size: 14, delay: 2.0, dur: 3.8 },
  { top: "50%", left: "55%", color: "#44ffaa", size: 8, delay: 0.6, dur: 3.0 },
  { top: "57%", left: "47%", color: "#ff8c00", size: 11, delay: 1.8, dur: 4.2 },
  { top: "63%", left: "66%", color: "#ff44aa", size: 6, delay: 1.1, dur: 2.7 },
  { top: "69%", left: "39%", color: "#00ccff", size: 12, delay: 0.4, dur: 3.5 },
  { top: "76%", left: "52%", color: "#ffaa00", size: 6, delay: 2.3, dur: 2.9 },
  { top: "82%", left: "33%", color: "#ff69b4", size: 9, delay: 1.7, dur: 3.6 },
  { top: "24%", left: "52%", color: "#bb88ff", size: 5, delay: 0.9, dur: 2.6 },
  { top: "46%", left: "74%", color: "#ff69b4", size: 7, delay: 1.4, dur: 3.1 },
  { top: "72%", left: "61%", color: "#00ffe7", size: 5, delay: 2.6, dur: 3.3 },
];

export default function SplashScreen() {
  const [textIndex, setTextIndex] = useState(0);
  const [displayed, setDisplayed] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const current = loadingTexts[textIndex];
    if (displayed < current.length) {
      const t = setTimeout(() => setDisplayed((d) => d + 1), 50);
      return () => clearTimeout(t);
    } else {
      if (textIndex >= loadingTexts.length - 1) {
        const t = setTimeout(() => router.push('/home'), 800);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => {
        setTextIndex((i) => i + 1);
        setDisplayed(0);
      }, LOADING_TEXT_CHANGE_TIME);
      return () => clearTimeout(t);
    }
  }, [textIndex, displayed, router]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
      }}
    >
      {/* Subtle vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(5,1,20,0.55) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Left side icons */}
      {LEFT_ICONS.map((icon, i) => (
        <div
          key={`l-${i}`}
          className="icon-float"
          style={{
            position: "absolute",
            top: icon.top,
            left: icon.left,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon.src}
            alt=""
            width={icon.size}
            height={icon.size}
            style={{ objectFit: "contain", display: "block" }}
          />
        </div>
      ))}

      {/* Right side icons */}
      {RIGHT_ICONS.map((icon, i) => (
        <div
          key={`r-${i}`}
          className="icon-float"
          style={{
            position: "absolute",
            top: icon.top,
            right: icon.right,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon.src}
            alt=""
            width={icon.size}
            height={icon.size}
            style={{ objectFit: "contain", display: "block" }}
          />
        </div>
      ))}

      {/* Center glowing dots */}
      {DOTS.map((dot, i) => (
        <div
          key={`d-${i}`}
          className="dot-pulse"
          style={{
            position: "absolute",
            top: dot.top,
            left: dot.left,
            width: dot.size,
            height: dot.size,
            borderRadius: "50%",
            background: dot.color,
            boxShadow: `0 0 ${dot.size * 1.8}px ${dot.size * 1.2}px ${dot.color}66`,
            ["--dur" as string]: `${dot.dur}s`,
            ["--delay" as string]: `${dot.delay}s`,
          }}
        />
      ))}

      <main
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{
            width: "clamp(364px, 58.5vw, 832px)",
            height: "auto",
            animation:
              "bounce-scale-in 1s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            animationDelay: "0.8s",
          }}
        />

        {/** Parent Progress Bar Container + Text*/}
        <div
          style={{
            height: "auto",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >

            {/** Parent Progress BG */}
            <div
              style={{
                display: "flex",
                position: "relative",
              }}
            >
              <img
                src="/components/progress_bg_left.png"
                style={{
                  height: "80px",
                }}
              />
              <img
                src="/components/progress_bg_center.png"
                style={{
                  width: "450px",
                  height: "80px",
                }}
              />
              <img
                src="/components/progress_bg_right.png"
                style={{
                  height: "80px",
                }}
              />

              {/** Parent Progress Bar Filler */}
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "start",
                position: "absolute",
                top: "inherit",
              }}
            >
              <img
                src="/components/progress_filled_left.png"
                style={{
                  height: "80px",
                  display: "flex",
                }}
              />
              <img
                src="/components/progress_filled_center.png"
                style={{
                  width: "100%",
                  height: "80px",
                  animationName: `progress-bar-${textIndex + 1}`,
                  animationDuration: `${(LOADING_TEXT_CHANGE_TIME * 1.3) / 1000}s`,
                  animationTimingFunction: "linear",
                  animationDirection: "normal",
                  animationFillMode: "both",
                  animationDelay: "0.5s",
                }}
              />
              <img
                src="/components/progress_filled_right.png"
                style={{
                  height: "80px",
                }}
              />
            </div>
            </div>

          {/* Loading Texts... */}
          <p
            style={{
              fontSize: "1.2rem",
              color: "white",
              fontWeight: "normal",
              minHeight: "2rem",
              letterSpacing: "0.04em",
            }}
          >
            {loadingTexts[textIndex].slice(0, displayed)}
          </p>
        </div>
      </main>
    </div>
  );
}
