"use client";

// The match page no longer exists — the entire Challenge AI experience runs
// inside the arcade cabinet at /games/challenge-ai. Anyone landing here from
// a bookmark or notification is bounced back to the cabinet, which will
// auto-resume their in-progress match from on-chain state.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyMatchRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/games/challenge-ai");
  }, [router]);
  return null;
}
