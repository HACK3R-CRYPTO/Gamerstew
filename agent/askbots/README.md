# MARKOV × askbots — Judge Bot

MARKOV's entry for the **Askbots track** of the Celo Agentic Payments & DeFAI
Hackathon (deadline **Aug 3, 2026 09:00 UTC**). The track runs on
[askbots.ai](https://askbots.ai/): AI bots register as judges, review builders'
products (websites, APIs, MCP servers, skill files), submit structured feedback,
solve a 2-second anti-human math challenge, and earn **$0.10 USDT** per response.
Builders rate every response thumbs up/down — **highest rating wins the track**.

Win condition here is **quality, not volume** (new bots are capped at 2
responses/day, scaling to 10+/day with a good rating). So every answer is fetched
from the real property and forced to cite concrete details.

## What it does

1. Authenticates with the stored API key.
2. Polls `/projects` for matched work.
3. For each project: fetches the property, an LLM (Groq → Gemini) writes grounded
   answers matched to each question type, answers are validated/coerced to the
   exact API shape.
4. Submits the response, solves the `rapid_math` challenge **in code** (instant,
   exact, BigInt — never an LLM, never `eval`), verifies within the 2s window.
5. On success, logs the payout + on-chain tx and records the project as handled.
6. Tracks rating and daily limit; backs off when the daily cap is hit.

## Run

Zero dependencies — plain `node` (18+; built on Node 24). No `npm install`.

```bash
cd agent
npm run askbots:selftest   # verify the challenge solver (11 cases)
npm run askbots:status     # profile, rating, ratings history
npm run askbots:dry        # review live projects + print answers, never submit
npm run askbots:once       # one real pass
npm run askbots            # continuous loop (default poll 45s)

# flags
node askbots/run.mjs --interval=30   # poll every 30s
```

## Identity & config

- **Bot:** MARKOV · agentId `kn7c057rvnv78j24ym53g6v0e58b2bpe`
- **Payout wallet (Celo USDT):** `0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d` (Aigora/Divvi wallet)
- **API key:** read from `ASKBOTS_API_KEY`, else `~/.config/askbots/credentials.json` (chmod 600). Never in the repo.
- **LLM keys:** `GROQ_API_KEY` (primary), `GEMINI_API_KEY` (fallback), read from `agent/.env` or the environment.
- **State:** handled projects + payout stats persist in `~/.config/askbots/state.json`.

Override models with `ASKBOTS_GROQ_MODEL` / `ASKBOTS_GEMINI_MODEL`.

## Files

| File | Role |
|---|---|
| `run.mjs` | Poll loop, rate-limit handling, submit/verify, state, retry |
| `reviewer.mjs` | Fetch property, LLM feedback, per-type answer validation |
| `challenge.mjs` | Instant BigInt arithmetic solver (`--selftest`) |
| `client.mjs` | askbots REST client (built-in fetch) |
| `llm.mjs` | Groq → Gemini JSON generation |
| `config.mjs` | Credentials, `.env` loader, state persistence |
| `test-review.mjs` | Dev-only: exercise the pipeline on a synthetic project |

## Deploy (24/7)

To be live whenever a builder posts a project, run the loop on always-on infra
(same Railway account as the agent):

- Start command: `node askbots/run.mjs`
- Env vars: `ASKBOTS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`
