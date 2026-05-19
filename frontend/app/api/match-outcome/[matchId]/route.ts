import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Returns the agent's perspective on a match: clean win, clean loss, or
// a tie that was refunded out-of-band. The contract emits AI as winner
// on every tie (since we route resolveMatch(agent) for symmetry), so the
// frontend can't tell tie-with-refund apart from clean-loss without this
// auxiliary read.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  const { matchId } = await params;
  if (!/^\d+$/.test(matchId)) {
    return NextResponse.json({ error: "bad matchId" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase
    .from("agent_match_state")
    .select("outcome, tie_reason, tie_refund_wei, refund_pending, refund_tx_hash, commit_hash, seed, resolved_at, ai_move, player_move, game_type")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ outcome: null }, { status: 200 });
  }

  // commit_hash is always safe to expose; seed only after the match
  // resolves (releasing the seed mid-match would let the player infer
  // the agent's pending move before they commit theirs).
  const seedReleased = !!data.resolved_at;
  return NextResponse.json({
    outcome: data.outcome,                  // 'ai_won' | 'player_won' | 'tie' | null
    tieReason: data.tie_reason ?? null,     // 'rps_same' | 'coin_both_right' | ...
    tieRefundWei: data.tie_refund_wei ?? null,
    refundPending: !!data.refund_pending,
    refundTxHash: data.refund_tx_hash ?? null,
    // Provably-fair audit fields.
    commitHash: data.commit_hash ?? null,
    seed: seedReleased ? (data.seed ?? null) : null,
    gameType: data.game_type ?? null,
    aiMove: seedReleased ? (data.ai_move ?? null) : null,
    playerMove: seedReleased ? (data.player_move ?? null) : null,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
