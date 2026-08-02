"use client";

// ─── GoodCollective picker ───────────────────────────────────────────────────
// The player chooses which GoodCollective their G$ spending's UBI share
// supports. Reads/writes the backend attribution ledger via server actions;
// options come from lib/collectives (verified entries only). Styled to the
// /settings row grammar (surface card, icon tile, radio-style rows).

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { COLLECTIVES, DEFAULT_COLLECTIVE_ID } from "@/lib/collectives";
import { getCollectiveChoice, chooseCollective } from "@/app/actions/collective";

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
const GOOD = "#22c55e";

export default function CollectivePicker() {
  const { address } = useAccount();
  const [chosen, setChosen] = useState<string>(DEFAULT_COLLECTIVE_ID);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getCollectiveChoice(address).then((id) => {
      if (!cancelled && id) setChosen(id);
    });
    return () => { cancelled = true; };
  }, [address]);

  if (!address) return null;

  const pick = async (id: string) => {
    if (id === chosen || saving) return;
    setSaving(id);
    const prev = chosen;
    setChosen(id); // optimistic
    const ok = await chooseCollective(address, id);
    setSaving(null);
    if (!ok) setChosen(prev);
    else { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600); }
  };

  return (
    <div style={{ borderRadius: 14, background: T.surface, border: `1px solid ${T.hairline}`, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px 4px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(34,197,94,0.14)", border: "1px solid rgba(134,239,172,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>💚</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700 }}>
            Your UBI collective {savedFlash && <span style={{ color: "#86efac", fontSize: 11 }}>· ✓ saved</span>}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 2, lineHeight: 1.35 }}>
            20% of every G$ you spend funds UBI — choose where yours goes
          </div>
        </div>
      </div>
      <div style={{ padding: "8px 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {COLLECTIVES.map((c) => {
          const on = chosen === c.id;
          return (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                padding: "10px 12px", borderRadius: 12, cursor: saving ? "wait" : "pointer",
                background: on ? "rgba(34,197,94,0.12)" : "rgba(0,0,0,0.25)",
                border: `1px solid ${on ? "rgba(134,239,172,0.5)" : T.hairline}`,
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <span style={{ fontSize: 17, flexShrink: 0 }}>{c.emoji}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: T.body, fontSize: 12.5, fontWeight: 700, color: T.ink }}>{c.name}</span>
                <span style={{ display: "block", fontFamily: T.body, fontSize: 10, color: T.inkSoft, marginTop: 1 }}>{c.tagline}</span>
              </span>
              <span style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? GOOD : "rgba(255,255,255,0.25)"}`, background: on ? GOOD : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#04160a", fontWeight: 900 }}>
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
        {COLLECTIVES.length === 1 && (
          <div style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, textAlign: "center", marginTop: 2 }}>
            More collectives coming as they're verified
          </div>
        )}
      </div>
    </div>
  );
}
