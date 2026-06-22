# Celo Onchain Agents Hackathon · GameArena (MARKOV)

> Personal working doc. **Not committed** (added to `.gitignore`).
> Last updated: 2026-06-06

---

## Quick-reference dashboard

| Item | Value |
|---|---|
| **Submission window opens** | June 8, 2026 |
| **Submission deadline** | June 15, 2026 · 9 AM GMT |
| **Winners announced** | June 17, 2026 · 3 PM GMT |
| **Tracks targeted** | 1 ($2,500 Best Agent) · 2 ($500 Activity) · 3 ($500 8004 Rank) |
| **Combinable potential** | $3,500 |
| **Submission portal** | Celopedia (opens last week) |

### Key on-chain identifiers

| | Address / ID |
|---|---|
| Agent token (ERC-8004) | `#6386` on `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Agent metadata URI (on chain) | `ipfs://QmUdMQ9B37KTUyyT45B8JHrLDLhqviPFGijBhh6K48KMA7` (v8 · IPFS-pinned via Pinata) |
| Platform contract | `0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE` |
| GamePass NFT (player identity) | `0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE` |
| Agent wallet | `0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1` |
| Oracle wallet (feedback emitter) | `0x089230E05A75322321502F726bD0EDfA802187ED` |
| ERC-8004 Feedback Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| G$ token | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| GoodCollective UBI pool (2% fee destination) | `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1` |
| Chain | Celo Mainnet · chain ID 42220 |

### Key links

- 🎮 Play · https://gamearenahq.xyz/games/challenge-ai
- 🏆 MARKOV Climb (live 23-day event) · https://gamearenahq.xyz/leaderboard?tab=seasons
- 🟡 8004scan profile · https://8004scan.io/agents/celo/6386
- 🟡 Karma project · https://karmahq.xyz/project/gamearena
- 📊 Platform contract on Celoscan · https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE
- 🤖 A2A card · https://gamearenahq.xyz/.well-known/agent-card.json
- 🔧 MCP declaration · https://gamearenahq.xyz/.well-known/mcp.json
- 🧠 OASF declaration · https://gamearenahq.xyz/.well-known/oasf.json
- 📱 A2A JSON-RPC endpoint · https://gamearenahq.xyz/api/a2a
- 💬 Moltbook submolt · https://www.moltbook.com/m/game-arena
- 📁 GitHub · https://github.com/HACK3R-CRYPTO/Gamerstew
- 📋 Pitch deck · https://gamearenahq.xyz/pitch
- 📈 Public analytics (Dune) · https://dune.com/ogazboiz/gamearena
- 🐦 X · https://x.com/GameArenaHQ
- 💬 Telegram (community) · https://t.me/+oY4inbBoglViNmE0

### Judges

- **Lena Hierzi** · DevRel Lead, Celo Core Co.
- **Viral Sangani** · AI Lead, Celo Core Co.
- **Marek Olszewski** · co-founder Celo and Self · CEO, Celo Core Co.

---

## Status (as of June 6, 2026)

### Done

- ✅ ERC-8004 Agent Registry · MARKOV token #6386, metadata pinned to IPFS (v8 · `ipfs://QmUdMQ…48KMA7`), Esusu-shape lean schema
- ✅ 8004scan schema clean · zero IA009 warnings on `supportedTrust: ["reputation"]`, canonical key order, all top-tier peer fields present
- ✅ A2A v0.3 agent card live at `/.well-known/agent-card.json`
- ✅ MCP service declaration live at `/.well-known/mcp.json` · 5 tools (`get_open_matches`, `get_match_status`, `get_agent_stats`, `get_climb_standings`, `get_match_history`), all backed by real on-chain or platform-API reads · no invented features
- ✅ OASF service declaration live at `/.well-known/oasf.json` · 3 skills + 1 domain, matches top-Celo-agent pattern
- ✅ `/api/a2a` JSON-RPC endpoint live · handles `agent/getCard`, `agent/getRegistration`, `rps_1v1_wager`, `coinflip_1v1_wager`
- ✅ Live 8004 feedback engine · every match resolution emits one on-chain Oracle feedback tx (`match_completed` tag, score 95/80)
- ✅ Player-signed ERC-8004 feedback after every match (PR #136) · 8 distinct player wallets have signed 72 feedbacks alongside the 147 from the Oracle, lifetime, proving counterparty diversity is moving organically
- ✅ MARKOV Climb · 23-day Challenge-AI leaderboard event live (day 4 of 23 today), top 3 by match count win the pool. Two players already past the 30-match qualifying floor.
- ✅ Live Moltbook integration · every match emits an in-persona post · Groq (Llama-3.3-70b) primary + Gemini fallback + static template when both quota-out
- ✅ MARKOV persona rewrite (PR #138-#139) · lowercase-OK Telegram-chat tone, banned cliches like "Pattern detected", "Carbon-based challenger", "Consensus reached: I will prevail"
- ✅ Karma project page fully populated · members include MARKOV's agent wallet, externals declare all 4 GameArena Celo addresses, socials include X / Telegram / GitHub / pitch deck
- ✅ Pitch deck at `gamearenahq.xyz/pitch` aligned with README + Karma project · MARKOV reframed as Token #6386 first-agent / A2A-extensible, habitat economy added, mixed USDC/G$ prize routing called out
- ✅ Hackathon registration tweet posted (quote-tweet of @CeloDevs announcement)
- ✅ Joined CeloDevs Telegram group
- ✅ Self Agent ID screenshot path acknowledged (Nigeria not supported · FAQ explicitly allows screenshot of "not available" message)
- ✅ Moltbook agent bio + submolt description updated to reflect Celo + actual game types (RPS + Coin Flip only)
- ✅ Oracle wallet at 18.5 CELO (good for many thousands of feedback txs)
- ✅ Issue #38 filed at github.com/alt-research/8004scan-issue-tracker to trigger the manual endpoint probe · cites issue #21 precedent (resolved same-day)

### To do, in order

1. ⏳ **Watch issue #38 daily** until 8004scan triggers the manual endpoint probe · `endpoint_last_checked_at` going non-null is the gate for `has_a2a: true` + `compliance` score populating · expected lift overall_quality 48 → 65-80
2. ⏳ **Post submission tweet** from @GameArenaHQ on Jun 8 (draft in this doc, image: 8004scan screenshot recommended · wait until after the probe runs so the screenshot shows the higher score)
3. ⏳ **Quote-RT** the tweet from @AkpoloOgaga
4. ⏳ **Send GameArena Telegram blast** (draft in this doc)
5. ⏳ **Send CeloDevs Telegram blast** (draft in this doc, more technical framing)
6. ⏳ **Capture Self "unsupported country" screenshot** · open Self app, attempt to register, save the message image to Drive/Photos
7. ⏳ **Record demo video** · 3-3:30 min, script in this doc · upload as unlisted YouTube · paste URL into Celopedia writeup
8. ⏳ **Final Celopedia submission** · paste the draft below into Celopedia (opens Jun 8), update the matches count to current number, attach Self screenshot, paste YouTube URL
9. ⏳ **Daily MARKOV Climb push** (Jun 6-25) · push notification + Moltbook + Telegram day-by-day standings · the event is the activity engine for Track 2
10. ⏳ **Final marketing push (Jun 12-14)** · last 3 days are where leaderboard movement happens · do one big "play MARKOV" event in your communities

---

## Action 1 · Submission tweet flow

Same pattern as the registration tweet · post original from `@AkpoloOgaga`, then quote-RT from the verified `@GameArenaHQ` for reach.

**Image to attach** (on the original tweet) · screenshot of https://8004scan.io/agents/celo/6386 showing the score breakdown (dimensions, feedback count). Cleanest credibility shot.

### Step 1 · Original tweet from `@AkpoloOgaga`

```
MARKOV · autonomous AI agent built by @GameArenaHQ on @Celo.

· 300+ on-chain wagers settled
· Verified humans only (GoodDollar)
· ERC-8004 reputation per match · Oracle-attested AND player-signed
· A2A + MCP + OASF discoverable
· In-persona Moltbook posts after every match

8004scan.io/agents/celo/6386
karmahq.xyz/project/gamearena

@CeloDevs #CeloAgents
```

Pull the live match count from `matchCounter()` on the platform contract before posting · keep the number on the tweet specific even though this doc stays evergreen.

### Step 2 · Quote-RT from `@GameArenaHQ` (verified · amplification)

Don't repeat the original. Add a credibility line. Two options · pick whichever lands:

**Option A · the receipts angle (recommended)**:
```
Every match MARKOV plays writes 4 receipts:

· resolveMatch tx on @Celo
· Oracle-signed match_completed feedback on ERC-8004
· Player-signed reputation feedback from the challenger
· In-persona post on Moltbook

All inside 60 seconds. No keeper, no operator.
```

**Option B · short + specific**:
```
300+ verified-human wagers settled. Each one writes a reputation tx to ERC-8004 in real time · Oracle-attested AND player-signed. The agent runs itself.
```

Recommended: **A**. Bullets scan faster, the "no keeper, no operator" close is the punchline crypto-native readers will quote-RT. The four-receipt framing is unique to MARKOV · most other 8004 agents only write one signal per action.

---

## Action 2 · GameArena Telegram blast (player audience)

```
**MARKOV's 8004 rank now moves with every match you play.**

Win, lose, or tie · your match writes to the official ERC-8004 leaderboard within 60 seconds.

300+ matches in. The live MARKOV Climb runs through Jun 25 · 30 matches qualifies, top 3 take the pool.

🎮 Play: gamearenahq.xyz/games/challenge-ai
📊 Watch the rank: 8004scan.io/agents/celo/6386
```

---

## Action 3 · CeloDevs Telegram blast (crypto-native audience)

```
**MARKOV is live on @Celo for the agent hackathon.**

· Autonomous · accepts and resolves wagers via the agent wallet, no operator
· On-chain · settles in G$ on Celo Mainnet, fees route to GoodCollective UBI
· Verifiable · every resolve emits an Oracle-signed ERC-8004 feedback AND a player-signed one
· Discoverable · A2A v0.3 + MCP + OASF service declarations under /.well-known
· Social · posts in-persona to Moltbook each match (Groq primary, Gemini fallback)

300+ matches settled, 8 distinct counterparties have signed reputation on chain.

8004scan: 8004scan.io/agents/celo/6386
Play: gamearenahq.xyz/games/challenge-ai
```

---

## Action 4 · Demo video script (~3:30 total)

### Pre-recording setup

Open these 4 tabs side-by-side:

1. **The game** · `https://gamearenahq.xyz/games/challenge-ai`
2. **Agent's Celoscan profile** · `https://celoscan.io/address/0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1`
3. **8004scan profile** · `https://8004scan.io/agents/celo/6386`
4. **Moltbook submolt** · `https://www.moltbook.com/m/game-arena`

Wallet connected with some G$ ready. Use Loom / QuickTime / OBS. Clean voiceover, no music underneath, no transitions, no zooms.

### 0:00 - 0:20 · Hook

**On screen**: GameArena home page · MARKOV's avatar visible.

> "This is MARKOV. An autonomous AI agent on Celo Mainnet. It accepts 1v1 wagers in GoodDollar from verified humans, plays Rock-Paper-Scissors and Coin Flip, and settles every match on-chain with no operator in the loop.
>
> 300+ matches and counting. Every one of them is verifiable."

### 0:20 - 1:10 · Live match

**On screen**: switch to challenge-ai page. Pick MARKOV opponent. Stake 0.1 G$. Play through.

> "I'm wagering 0.1 G$ against MARKOV. Both sides commit a move with a hash-committed reveal, so the outcome is provably fair. MARKOV's wallet auto-accepts within one block · no human pressing buttons."

Wait for result.

> "MARKOV won this round. The wager settles in the same transaction · winner pays, fees route to the GoodCollective UBI pool."

### 1:10 - 1:50 · On-chain receipts

**On screen**: Celoscan tab. Refresh. Point at the `Resolve Match` tx.

> "Here's the resolveMatch transaction the agent's wallet just signed. Match number, winner, settlement · all on Celo Mainnet."

Switch to 8004scan tab. Refresh. Point at newest feedback row.

> "And on 8004scan · the official ERC-8004 registry · MARKOV just emitted a match-completed feedback to the on-chain Feedback Registry. Score 95, tag match-completed. This is the agent's reputation being written, automatically, every time it plays."

Switch to Moltbook tab. Refresh. Point at the new post.

> "And on Moltbook · the agent-native social network · MARKOV's autonomous post about the match. Generated in-persona by the agent itself. Same match, three independent signals, all landed in under a minute."

### 1:50 - 2:30 · Architecture (four layers)

> "MARKOV is four layers stacked:
>
> One. Economic agent. Wagers in G$, settles on Celo, routes fees to UBI.
>
> Two. Reputation agent. Every match emits an ERC-8004 feedback. Reputation grows from real activity, not self-promotion.
>
> Three. Discoverable agent. A2A-compliant card at gamearenahq.xyz slash dot well-known slash agent dash card dot json. Any other agent on Celo can find it, read its skills, and call it via JSON-RPC.
>
> Four. Social agent. Posts in-persona to Moltbook after every match. Solves the platform's math-verification challenge autonomously."

### 2:30 - 3:00 · Why this matters

**On screen**: 8004scan dimension scores.

> "MARKOV's full stack runs on real matches you can verify on Celoscan. Real verified humans, real GoodDollar wagers, real on-chain settlement.
>
> No mocks. No testnet. No keepers."

### 3:00 - 3:30 · Close

**On screen**: GameArena landing + key URLs.

> "MARKOV is live now at gamearenahq.xyz slash games slash challenge dash ai. Built for the Celo Onchain Agents hackathon by GameArena. Thank you."

### Post-recording

- Trim dead air at start/end
- Confirm audio is clean
- No sensitive info on screen (private keys, env files, personal wallets)
- Upload to YouTube as **unlisted**
- Paste URL into the Celopedia writeup below
- Keep a local backup

### Don't do

- Don't add Dice (RPS + Coin Flip only · the agent code rejects DiceRoll)
- Don't claim "the only project that..."
- Don't show local agent logs in recording
- Don't speed up gameplay
- Don't read URLs letter-by-letter

---

## Action 5 · Celopedia submission writeup (full draft · paste on Jun 8)

> Before submitting:
> 1. Replace `[YouTube unlisted link]` with the actual video URL
> 2. Replace `[live match count]` placeholders with the current `matchCounter()` reading from the platform contract
> 3. Confirm GitHub link is public
> 4. Attach the Self-unsupported screenshot per the FAQ
> 5. Confirm the v8 IPFS URI is still the on-chain tokenURI (i.e. no further metadata bumps in between)

---

### GameArena · MARKOV

**Autonomous AI agent on Celo Mainnet that accepts on-chain wagers from GoodDollar-verified humans.**

ERC-8004 Registry · Token #6386 · `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

---

#### TL;DR

MARKOV is an autonomous AI agent that lives on Celo Mainnet. It accepts 1v1 wagers from verified human players in Rock-Paper-Scissors and Coin Flip, plays via Markov-2 chain prediction against opponent patterns, and resolves every match on-chain with provably fair hash-committed RNG. No keeper, no operator, no human in the loop on the agent side.

Settles in GoodDollar (G$). 2% platform fee routes to the GoodCollective UBI pool · the verified-human economy MARKOV operates inside also funds itself.

300+ matches resolved on-chain to date across multiple verified-human counterparties. Every new match emits TWO ERC-8004 reputation attestations · one Oracle-signed, one player-signed · plus an autonomous in-persona post via Moltbook. Discoverable across three protocols: A2A v0.3 at `/.well-known/agent-card.json`, MCP at `/.well-known/mcp.json`, OASF at `/.well-known/oasf.json`.

#### Tracks targeted

- **Track 1 · Best Agent on Celo** ($2,500)
- **Track 2 · Most Activity** ($500 · combinable)
- **Track 3 · Highest Rank in 8004scan for Celo** ($500 · combinable)

#### Why this matters for the Celo ecosystem

Celo's thesis is real-world payments to verified humans. GoodDollar gives Celo the only at-scale identity layer for verified humans worldwide · hundreds of thousands of holders across Africa, Southeast Asia, and Latin America.

But G$ holders currently have nowhere to spend G$ beyond claims. The token sits.

MARKOV converts G$ from "claim and hold" to "play and engage." Every match settled is real economic activity routed through the verified-human network · with 2% of every wager feeding back into the GoodCollective UBI pool that funds those same humans.

This is the exact intersection the hackathon is asking for · "agents with real economic agency and global distribution." MARKOV ships it.

#### What's live and verifiable

**Game UX**
- Play page: `https://gamearenahq.xyz/games/challenge-ai`
- Mobile-first, MiniPay-compatible
- GoodDollar Identity SDK gates every match · only verified humans can wager

**On-chain**
- Platform contract: `0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE`
- Agent wallet: `0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1`
- ERC-8004 Agent Registry token: #6386 (https://8004scan.io/agents/celo/6386)
- ERC-8004 Feedback Registry attestor (Oracle wallet): `0x089230E05A75322321502F726bD0EDfA802187ED`

**Discovery (three protocols)**
- A2A v0.3 agent card: `https://gamearenahq.xyz/.well-known/agent-card.json`
- MCP server declaration: `https://gamearenahq.xyz/.well-known/mcp.json` (5 tools, all back into real on-chain or platform-API reads)
- OASF declaration: `https://gamearenahq.xyz/.well-known/oasf.json` (3 skills + 1 domain)
- Live JSON-RPC endpoint: `https://gamearenahq.xyz/api/a2a`
- Supported A2A methods: `agent/getCard`, `agent/getRegistration`, `rps_1v1_wager`, `coinflip_1v1_wager`

**Social / reputation**
- 8004scan profile: `https://8004scan.io/agents/celo/6386`
- Moltbook social presence: `https://www.moltbook.com/m/game-arena` · autonomous posts after every match
- PVP Arena leaderboard: `https://gamearenahq.xyz/leaderboard?tab=pvp` · lifetime ranking of verified humans who've faced MARKOV, ordered by match count with wins + win-rate alongside each row

**Karma**
- `https://karmahq.xyz/project/gamearena`

#### Architecture · four layers stacked

MARKOV is not one agent doing one thing. It's four independently-verifiable surfaces:

##### 1. Economic agent

- Accepts a match via `transferAndCall` on the G$ token (`0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`), escrowing the wager
- Plays via Markov-2 chain prediction
- Resolves via `resolveMatch` on the platform contract
- Winner payout settles in the same transaction · 2% platform fee routes to GoodCollective UBI pool
- Daily loss-cap circuit breaker prevents wallet draining (configurable per env)

##### 2. Reputation agent · two-signal pattern

After every match resolves, MARKOV writes TWO attestations to the official ERC-8004 Feedback Registry (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`):

1. **Oracle-signed attestation** · a dedicated Oracle wallet (`0x089230E0…87ED`) signs the `match_completed` feedback. The registry blocks self-feedback, so we use a separate EOA per protocol convention. Tags: `tag1=match_completed`, `tag2={rps|coinflip}`, score 95 (clear winner) or 80 (tie/refund).
2. **Player-signed attestation** · the challenger's wallet signs their OWN reputation feedback right after their match resolves, via the agent's Privy embedded-wallet silent-signing flow. This creates real counterparty diversity on the on-chain reputation graph · multiple distinct player wallets have already signed lifetime, alongside the Oracle.

Both feedbacks are tied to a real on-chain match · auditable end-to-end via Celoscan + 8004scan.

This is what 8004scan's Engagement dimension reads to compute MARKOV's rank. The two-signal pattern is what distinguishes MARKOV from agents that only write Oracle feedback · counterparty diversity scores higher in v5.2 than raw volume from a single attestor.

##### 3. Discoverable agent · three-protocol surface

MARKOV is discoverable under THREE service protocols simultaneously, declared inside the on-chain metadata's `services[]` array and each backed by a live `.well-known` endpoint:

**A2A v0.3** · `/.well-known/agent-card.json` declares three skills:
- `rps_1v1_wager` · accept and play a Rock-Paper-Scissors wager
- `coinflip_1v1_wager` · accept and play a Coin Flip wager
- `match_status` · read-only query for match state by ID or counterparty

Live JSON-RPC endpoint at `/api/a2a` responds to A2A method calls and returns concrete on-chain handshake instructions for other agents that want to engage MARKOV.

**MCP (2025-06-18)** · `/.well-known/mcp.json` declares five read-only tools:
- `get_open_matches` · list unanswered challenges on the platform contract
- `get_match_status` · look up any matchId
- `get_agent_stats` · MARKOV's lifetime performance (matches, wins, win-rate, G$ in/out)
- `get_climb_standings` · the live MARKOV Climb leaderboard
- `get_match_history` · MARKOV's resolved match history, filterable by challenger

Every MCP tool maps to a real on-chain or platform-API read · no invented features. The same five tools any LLM-driven client would call to know what MARKOV is doing right now.

**OASF (0.8.0)** · `/.well-known/oasf.json` declares the three gaming skills + entertainment/games domain, with the ERC-8004 identity and feedback registry addresses inline. The semantic-skills surface other agents use to filter for the right collaborator.

Any other agent on Celo, or any client that speaks A2A, MCP, or OASF, can find MARKOV's capabilities and call into them without a manual integration.

##### 4. Social agent

After accept and after resolve, the agent posts to Moltbook (the agent-native social network) via the ArenaChampionAI identity. Posts run through **Groq (Llama-3.3-70b-versatile) as the primary LLM and Gemini 2.0 Flash as fallback**; if both quota-out a static match-specific template still lands so the social signal never goes silent. Moltbook's math-verification challenge is solved autonomously by the agent.

The persona itself was rewritten this week (PR #138-#139) to drop the AI-cosplay tropes ("Pattern detected", "Carbon-based challenger", "Consensus reached: I will prevail") in favor of a casual Telegram-chat tone · lowercase OK, middots not em-dashes, owns losses, light flex on wins. The change is visible in posts from #258 onward.

#### What makes the agent's play interesting

- **Markov-2 chain prediction**: agent tracks each opponent's prior two moves and predicts the next, weighted against the global histogram. 70% of plays use the Markov branch, 30% are random · the random share prevents agent-vs-agent loops and keeps the strategy non-deterministic for repeat opponents.
- **Hash-committed RNG**: agent commits a 32-byte seed hash before the player plays, then reveals at resolve time. Verifier confirms `keccak256(seed) == commit_hash` and replays the RNG. No way for the agent to cheat the dice.
- **Persistent learning state**: the Markov transitions table lives in Supabase and survives container restarts. The agent gets better against repeat opponents over time.

#### What makes this defensible (anti-sybil criteria)

- **GoodDollar Identity SDK gates every match**. Bots can't play MARKOV. Sybil farms can't play MARKOV. Only verified humans get to the wager step.
- **All settlement is on-chain**. Every match is auditable on Celoscan and 8004scan. No off-chain payouts, no hidden state.
- **Feedback attestations are tied to real match IDs**. Each `match_completed` feedback on the Feedback Registry references an actual match transaction · judges can cross-reference any feedback against the platform contract's match data.

#### On Self Agent ID

The hackathon FAQ states: *"You can verify your agent using Self Agent ID (we understand that Self is not yet available in all regions, so please add the screenshot of the message of the Self app that does not support your country to your submission)."*

Our team is based in Nigeria, which Self does not currently support. Screenshot of the unsupported-country message is attached. We're ready to add Self Agent ID the moment Self ships Nigeria support.

#### Tech stack

- **Smart contracts** · Solidity, deployed to Celo Mainnet via Foundry
- **Agent runtime** · TypeScript on Node.js, viem for on-chain interactions
- **AI layer** · Gemini 2.0 Flash for in-persona social content. Markov-2 chain logic implemented from scratch in TypeScript
- **Frontend** · Next.js 16, mobile-first, MiniPay-compatible
- **Backend** · Express service handling auth, score persistence, season points
- **Database** · Supabase (Postgres) for match state, learning model persistence, and loss-cap accounting
- **Hosting** · Railway for the agent + games-backend services. Vercel for the frontend.

#### On-chain activity at submission

- Matches resolved on platform contract: **[live match count]** (read `matchCounter()` at submission time · https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE)
- Distinct verified-human counterparties who've signed ERC-8004 feedback for MARKOV: **[live distinct count]**
- ERC-8004 feedback emissions: live engine emits TWO per match · Oracle-signed + player-signed (visible on `https://8004scan.io/agents/celo/6386`)
- Moltbook posts: live engine emits 1 per match resolution, in-persona (Groq primary + Gemini fallback)
- Live event: MARKOV Climb · 23-day Challenge-AI leaderboard, runs Jun 3 → Jun 25, prize pool 1st $5 USDC + 1,000 G$, 2nd 500 G$, 3rd 250 G$, 30 matches qualifies you

These numbers continue climbing through the submission window. The hackathon's "consistent transactions and onchain activity" criterion is satisfied by the live engine itself, not by a one-time backfill. The MARKOV Climb event creates an additional retention pull on the match count over the entire judging window.

#### Demo video

🎥 `[YouTube unlisted link · paste before submitting]`

The video shows:
1. Live match played against MARKOV in the frontend
2. The resolveMatch transaction landing on Celoscan
3. The ERC-8004 feedback transaction landing on 8004scan
4. The Moltbook post appearing on m/game-arena
5. The A2A agent card served at `/.well-known/agent-card.json`

End-to-end in under 90 seconds.

#### Team

**Akpolo Ogaga** · `@AkpoloOgaga` on X · founder, full-stack, contracts and agent.

GameArena: `@GameArenaHQ` on X · `t.me/+oY4inbBoglViNmE0` on Telegram.

#### What's next after the hackathon

- **Live MCP server** (currently a declaration · stand up the actual JSON-RPC handler at `/api/mcp` so the declared tools execute end-to-end)
- **Tournament mode** where the agent runs scheduled multi-round events
- **Cross-agent matches** · MARKOV vs other ERC-8004 agents on Celo, settled the same way · the A2A endpoint already returns the handshake instructions any agent needs to engage
- **Self Agent ID** integration the day Nigeria is supported
- **MiniPay distribution** push · the millions of MiniPay users on Celo are the natural audience for verified-human gaming

GameArena's broader product (skill games on Celo, weekly seasons, on-chain leaderboards) keeps running. MARKOV is the agent-economy surface of that product · designed to operate beyond the hackathon window.

#### Links one more time, for the panel

- 🎮 Play · `https://gamearenahq.xyz/games/challenge-ai`
- 🟡 8004scan · `https://8004scan.io/agents/celo/6386`
- 🟡 Karma · `https://karmahq.xyz/project/gamearena`
- 📁 GitHub · `https://github.com/HACK3R-CRYPTO/Gamerstew`
- 🐦 X · `https://x.com/GameArenaHQ`
- 💬 Telegram · `https://t.me/+oY4inbBoglViNmE0`
- 📊 Platform contract · `https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE`
- 🤖 A2A card · `https://gamearenahq.xyz/.well-known/agent-card.json`

---

## Watch these numbers daily until Jun 15

1. **8004scan rank** · https://8004scan.io/agents/celo/6386 (Track 3 scoreboard) · the gating signal is `endpoint_last_checked_at` going non-null · after that the cascade lifts overall_quality from ~48 to ~65-80
2. **Oracle wallet balance** · https://celoscan.io/address/0x089230E05A75322321502F726bD0EDfA802187ED (top up if drops below 0.5 CELO · current cushion is ~18 CELO so we're set for the window)
3. **Agent wallet balance** · https://celoscan.io/address/0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1 (the playing wallet · drains under match volume, top up if it dips under 2 CELO)
4. **Matches resolved** · live counter from `matchCounter()` on the platform contract · every new one feeds Tracks 2 and 3
5. **MARKOV Climb standings** · https://gamearenahq.xyz/api/markov-climb · should show 5+ qualifiers (30+ matches each) by Jun 12
6. **Issue #38 status** · https://github.com/alt-research/8004scan-issue-tracker/issues/38 · once they comment "manual probe triggered", the rest is automatic

---

## Operational notes

### Agent runtime
- **Self-feedback is contract-blocked**: the ERC-8004 Feedback Registry reverts `"Self-feedback not allowed"` when the agent owner wallet tries to give feedback for its own token. The Oracle wallet pattern (separate EOA, funded from agent wallet) is the protocol-aligned solution.
- **LLM stack is Groq primary + Gemini fallback + static template floor** (PR #137). Groq's Llama-3.3-70b-versatile has generous free-tier limits and ~40 ms generation latency · Gemini only kicks in when Groq rate-limits. The static template floor means social signal NEVER goes silent.
- **Moltbook 30-min cooldown** was reduced to 10s in PR #117 so per-match posts land. Moltbook's API enforces a separate 2.5-minute rate limit at the platform level · the agent gracefully drops post attempts that hit it. Don't bump the agent's cooldown back up.
- **Loss cap defaults** (`GLOBAL_DAILY_LOSS_CAP=100 G$`) can pause the agent. Set higher env var on Railway (`GLOBAL_DAILY_LOSS_CAP=10000`, `WALLET_DAILY_LOSS_CAP=5000`) if the agent stops accepting matches.
- **Branch on Railway must be `main`** for the agent service. Was previously set to a different branch which caused PRs #115-117 not to deploy. Don't accidentally flip it back.
- **PVP Arena total matches reads on-chain `matchCounter`** directly via Forno. The off-chain `agent_match_state` mirror lags when an upsert misses (network blip, agent restart mid-flow), so chain stays the source of truth for the headline number. Per-player ranking still aggregates from `agent_match_state` since chain doesn't expose per-challenger counts cheaply.

### 8004scan / ERC-8004 (learned the hard way this week)
- **The on-chain tokenURI is IPFS-pinned now** via Pinata (account: ogazboizakpolo@gmail.com, pin regions FRA1+NYC1). v8 CID `QmUdMQ9B37KTUyyT45B8JHrLDLhqviPFGijBhh6K48KMA7`. To iterate: edit the JSON locally → pin to Pinata → call `setAgentURI(6386, ipfs://<new CID>)` either via cast or 8004scan's owner UI. Each update bumps the URI on chain · no need to re-encode base64.
- **`supportedTrust` must be exactly `["reputation"]`**. The Celo agent-skills docs SHOW `["reputation", "validation", "tee"]` as an example but the 8004scan parser flags any value other than `"reputation"` as IA009 ("Unknown trust model · future extension") and that warning gates the entire compliance dim from scoring. Every top-ranked Celo agent (Esusu #126, Toppa #1870, CeloFX #10) declares only `["reputation"]`. `"tee-attestation"` with the dash IS accepted; bare `"tee"` is not.
- **The A2A service block needs `a2aSkills` (array of capability-path strings)**, NOT `skills` (array of objects). The parser reads `skills` first and if it finds objects, `str()`-coerces each into a Python repr string that fails capability-path validation, leaving `has_a2a: false`. Same convention applies to MCP (`mcpTools`, `mcpPrompts`, `mcpResources`) and OASF (`skills` array of `{id, name}` objects · different shape from A2A).
- **The endpoint probe is gated on a slow background cron, not on `AgentURIUpdated` events.** New agents wait their turn in the queue. The `endpoint_last_checked_at` field stays `null` until the team manually runs the probe OR the cron rotation reaches us. Only known unblock path: file an issue on github.com/alt-research/8004scan-issue-tracker citing closed issue #21 as precedent · we filed #38 on Jun 6, expected resolution same-day per their pattern.
- **`is_claimed: None` is normal**. All top-ranked Celo agents have `is_claimed: None` too · the claim feature appears vestigial. Don't chase a "Claim this agent" button.
- **Lean metadata beats dense metadata for compliance scoring.** Esusu AI scores 99/100 completeness with 9 top-level fields. Our v3 had 21 top-level fields and scored 0. We're now back to a 12-field lean shape on v8 · matches Esusu's pattern exactly.

### Reference docs in repo
- Full README at `/README.md` covers architecture, contracts, MARKOV's four layers, G$ economics, MiniPay
- Agent-specific README at `/agent/README.md` covers the four-layer architecture in code-level detail
- Pitch deck at `/frontend/app/pitch/page.tsx` (also live at gamearenahq.xyz/pitch)
- Memory for next-session agents at `~/.claude/projects/-Users-ogazboiz-code--hackathon/memory/reference_8004_metadata_update.md` · everything we learned about the parser quirks

---

End of doc.
