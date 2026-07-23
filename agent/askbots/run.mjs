// run.mjs — MARKOV's askbots judge loop.
//
// Polls for matched feedback projects, reviews each property, submits grounded
// answers, solves the 2s anti-human challenge in code, collects the $0.10 USDT
// payout, and tracks its rating. Zero external dependencies — runs on plain
// `node` (Node 18+ for global fetch; built and tested on Node 24).
//
// Two ways to run:
//   1) Standalone CLI:
//        node askbots/run.mjs            # continuous loop (default poll 45s)
//        node askbots/run.mjs --once     # single pass then exit
//        node askbots/run.mjs --dry      # review + print answers, never submit
//        node askbots/run.mjs --status   # show profile, rating, ratings history
//        node askbots/run.mjs --interval=30
//   2) Embedded (Railway piggyback): `import { startJudgeLoop } from './askbots/run.mjs'`
//      and call startJudgeLoop() fire-and-forget from the agent's boot.
import { AskbotsClient, HttpError } from './client.mjs';
import { solveChallenge } from './challenge.mjs';
import { generateAnswers } from './reviewer.mjs';
import { loadState, saveState } from './config.mjs';
import { pathToFileURL } from 'node:url';

const log = (...a) => console.log(new Date().toISOString(), '[askbots]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function showStatus(client) {
  const [profile, ratings] = await Promise.all([
    client.getProfile().catch((e) => ({ error: e.message })),
    client.getRatings().catch((e) => ({ error: e.message })),
  ]);
  log('PROFILE', JSON.stringify(profile, null, 2));
  log('RATINGS', JSON.stringify(ratings, null, 2));
}

// Handle one project end-to-end. Returns 'paid' | 'skipped' | 'failed' | 'done'.
async function handleProject(client, project, state, opts) {
  const id = project.id;
  if (state.responded[id]) return 'skipped';

  const qCount = (project.questions || []).length;
  log(`→ project ${id} "${project.name}" [${project.propertyType}] ${qCount} questions`);

  let gen;
  try {
    gen = await generateAnswers(project);
  } catch (e) {
    log(`  ✗ answer generation failed: ${e.message}`);
    return 'failed';
  }
  log(`  reviewed via ${gen.provider} · ${gen.note}`);
  for (const a of gen.answers) {
    const preview = String(a.answer).replace(/\s+/g, ' ').slice(0, 100);
    log(`    ${a.questionId}: ${preview}`);
  }

  if (opts.dry) {
    log('  [dry] not submitting');
    return 'done';
  }

  // Submit + solve challenge, with one retry on a bad challenge answer.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let challenge;
    try {
      challenge = await client.respond(id, gen.answers);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        log('  already responded (409) — marking done');
        state.responded[id] = { at: Date.now(), status: 'already' };
        saveState(state);
        return 'skipped';
      }
      log(`  ✗ respond failed: ${e.message}`);
      return 'failed';
    }

    const t0 = performance.now();
    let answer;
    try {
      answer = solveChallenge(challenge.prompt);
    } catch (e) {
      log(`  ✗ could not solve challenge "${challenge.prompt}": ${e.message}`);
      return 'failed';
    }
    const solveMs = (performance.now() - t0).toFixed(1);

    try {
      const result = await client.verifyChallenge(id, challenge.challengeId, answer);
      if (result.passed) {
        log(`  ✓ PAID ${result.payout} ${result.currency} · solved in ${solveMs}ms · tx ${result.txHash || 'n/a'}`);
        state.responded[id] = { at: Date.now(), status: 'paid', txHash: result.txHash };
        state.stats.responses++;
        state.stats.payouts++;
        saveState(state);
        return 'paid';
      }
      log(`  ✗ challenge rejected (attempt ${attempt}): ${result.error || 'unknown'} · answer=${answer} · ${solveMs}ms`);
    } catch (e) {
      log(`  ✗ verify failed (attempt ${attempt}): ${e.message}`);
    }
  }
  state.stats.failures++;
  saveState(state);
  return 'failed';
}

async function pass(client, state, opts) {
  let profile;
  try {
    profile = await client.getProfile();
  } catch (e) {
    log(`profile fetch failed: ${e.message}`);
    return;
  }
  const remaining = profile?.dailyLimit?.remaining ?? 0;
  log(`rating=${profile.rating} reviews=${profile.totalReviews} daily=${profile?.dailyLimit?.currentCount}/${profile?.dailyLimit?.limit} (remaining ${remaining})`);

  if (!opts.dry && remaining <= 0) {
    log('daily limit reached — waiting for reset');
    return;
  }

  let projects;
  try {
    projects = (await client.getProjects())?.projects || [];
  } catch (e) {
    log(`projects fetch failed: ${e.message}`);
    return;
  }
  const fresh = projects.filter((p) => !state.responded[p.id]);
  if (!fresh.length) {
    log(`no new projects (${projects.length} matched, all handled)`);
    return;
  }
  log(`${fresh.length} new project(s) to review`);

  let budget = opts.dry ? fresh.length : remaining;
  for (const project of fresh) {
    if (budget <= 0) { log('out of daily budget for this pass'); break; }
    const outcome = await handleProject(client, project, state, opts);
    if (outcome === 'paid') budget--;
  }
}

// Embeddable entrypoint. Returns the loop promise; safe to fire-and-forget.
export async function startJudgeLoop({ once = false, dry = false, intervalMs = 45000 } = {}) {
  let client;
  try {
    client = new AskbotsClient();
  } catch (e) {
    log(`disabled: ${e.message}`);
    return;
  }
  const opts = { once, dry, intervalMs };

  try {
    const s = await client.status();
    log(`authenticated as ${s.name} (${s.agentId}) · status=${s.status}${dry ? ' · DRY RUN' : ''}`);
  } catch (e) {
    log(`AUTH FAILED, not starting: ${e.message}`);
    return;
  }

  const state = loadState();
  log(`state: ${Object.keys(state.responded).length} projects handled · ${state.stats.payouts} payouts so far`);

  do {
    try { await pass(client, state, opts); } catch (e) { log('pass error:', e.message); }
    if (!once) await sleep(intervalMs);
  } while (!once);
}

// --- CLI --------------------------------------------------------------------
async function cli() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const optVal = (n, d) => {
    const m = args.find((a) => a.startsWith(`--${n}=`));
    return m ? m.split('=')[1] : d;
  };

  if (flag('status')) {
    const client = new AskbotsClient();
    await showStatus(client);
    return;
  }
  await startJudgeLoop({
    once: flag('once'),
    dry: flag('dry'),
    intervalMs: Math.max(10, parseInt(optVal('interval', '45'), 10)) * 1000,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((e) => { console.error(e); process.exit(1); });
}
