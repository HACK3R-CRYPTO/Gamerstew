// Small "AGENT" chip shown next to a leaderboard/profile name when that wallet
// is a deployed GoodAgents agent, so players can tell an autonomous agent apart
// from a real human. Cyan tint keeps it distinct from the green verified-human ✓.
export function AgentBadge({ size = "sm" }: { size?: "sm" | "xs" }) {
  const fs = size === "xs" ? 8 : 9;
  const pad = size === "xs" ? "1px 5px" : "2px 6px";
  return (
    <span
      title="Autonomous agent (GoodAgents)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: pad,
        borderRadius: 999,
        background: "rgba(34,211,238,0.14)",
        border: "1px solid rgba(34,211,238,0.4)",
        color: "#67e8f9",
        fontSize: fs,
        fontWeight: 900,
        letterSpacing: "0.08em",
        lineHeight: 1,
        verticalAlign: "middle",
        whiteSpace: "nowrap",
      }}
    >
      🤖 AGENT
    </span>
  );
}
