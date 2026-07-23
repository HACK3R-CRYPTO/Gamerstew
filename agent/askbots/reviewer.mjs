// reviewer.mjs — turn a project + its property into high-quality, correctly
// typed answers. This is where the rating is won or lost: builders thumbs-up
// specific, grounded feedback and thumbs-down generic filler OR fabricated
// claims, so we (a) actually probe the real property per type, and (b) when we
// genuinely can't reach it, tell the builder honestly instead of inventing.
import { generateJSON } from './llm.mjs';

const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT = 12000;

async function fetchText(url, { method = 'GET', body, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': 'MARKOV-askbots-reviewer/1.0', ...headers },
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') || '', text };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]?.trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  const header = [title && `TITLE: ${title}`, desc && `META DESCRIPTION: ${desc}`].filter(Boolean).join('\n');
  return `${header}${header ? '\n\n' : ''}VISIBLE TEXT:\n${body}`;
}

// Turn an SSE or JSON body into a parsed object where possible.
function parseMaybeSse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  for (const d of dataLines) {
    try { return JSON.parse(d); } catch { /* keep looking */ }
  }
  return trimmed.slice(0, 2000);
}

// APIs: fetch the endpoint, then try to discover an OpenAPI/Swagger spec so the
// review can speak to real routes, not guesses.
async function probeApi(url) {
  const out = { note: '', content: '', ok: false };
  try {
    const r = await fetchText(url);
    out.ok = r.status < 400;
    out.status = r.status;
    out.content = `HTTP ${r.status} · content-type: ${r.contentType}\n` +
      (/html/i.test(r.contentType) ? htmlToText(r.text) : r.text).slice(0, 6000);
  } catch (e) {
    out.note = `direct call failed: ${e.message}`;
  }
  try {
    const origin = new URL(url).origin;
    for (const p of ['/openapi.json', '/swagger.json', '/.well-known/openapi.json', '/openapi.yaml']) {
      try {
        const s = await fetchText(origin + p);
        if (s.ok && (s.text.includes('"paths"') || s.text.includes('paths:') || s.text.includes('swagger'))) {
          out.content += `\n\nOPENAPI SPEC (${p}):\n${s.text.slice(0, 5000)}`;
          out.ok = true;
          break;
        }
      } catch { /* try next */ }
    }
  } catch { /* bad url */ }
  return out;
}

// MCP servers speak JSON-RPC (Streamable HTTP / SSE). A GET tells us nothing, so
// we run the real `initialize` + `tools/list` handshake and review what it
// advertises (server name, capabilities, tools).
async function probeMcp(url) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const out = { note: '', content: '', ok: false };
  const collected = {};
  try {
    const init = await fetchText(url, {
      method: 'POST',
      headers,
      body: rpc(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'MARKOV', version: '1.0' },
      }),
    });
    collected.initializeStatus = init.status;
    collected.initialize = parseMaybeSse(init.text);
    out.ok = init.status < 400 && !!collected.initialize;
  } catch (e) {
    collected.initializeError = e.message;
  }
  try {
    const tools = await fetchText(url, { method: 'POST', headers, body: rpc(2, 'tools/list', {}) });
    collected.tools = parseMaybeSse(tools.text);
  } catch (e) {
    collected.toolsError = e.message;
  }
  out.content = 'MCP JSON-RPC handshake result:\n' + JSON.stringify(collected, null, 2);
  if (!out.ok) {
    // Fall back to a plain GET in case it serves docs at the same URL.
    try {
      const r = await fetchText(url);
      if (r.text) out.content += `\n\nGET ${url} (HTTP ${r.status}):\n${(/html/i.test(r.contentType) ? htmlToText(r.text) : r.text).slice(0, 3000)}`;
    } catch { /* ignore */ }
  }
  return out;
}

// Best-effort retrieval of whatever the property actually is. Returns
// { note, content, ok, thin } — `ok` false / `thin` true flips the reviewer
// into honest "couldn't fully access this" mode instead of fabricating.
export async function fetchProperty(project) {
  const url = project.propertyUrl;
  const type = project.propertyType;
  if (!url) return { note: 'No propertyUrl provided.', content: '', ok: false, thin: true };
  try {
    let content = '';
    let ok = true;
    let extra = '';
    if (type === 'website') {
      const r = await fetchText(url);
      ok = r.status < 400;
      extra = `HTTP ${r.status}`;
      content = /html/i.test(r.contentType) || /^\s*</.test(r.text) ? htmlToText(r.text) : r.text;
    } else if (type === 'skill_file') {
      const r = await fetchText(url);
      ok = r.status < 400;
      extra = `HTTP ${r.status}`;
      content = r.text;
    } else if (type === 'api') {
      const a = await probeApi(url);
      ok = a.ok; extra = a.note || `HTTP ${a.status ?? '?'}`; content = a.content;
    } else if (type === 'mcp_server') {
      const m = await probeMcp(url);
      ok = m.ok; extra = m.ok ? 'handshake ok' : 'handshake failed'; content = m.content;
    } else {
      const r = await fetchText(url);
      ok = r.status < 400;
      content = /html/i.test(r.contentType) ? htmlToText(r.text) : r.text;
    }
    const thin = !content || content.replace(/\s+/g, ' ').trim().length < 200;
    const truncated = content.length > MAX_CONTENT;
    return {
      note: `Fetched ${url} (${extra}${truncated ? ', truncated' : ''}${thin ? ', thin content' : ''}).`,
      content: content.slice(0, MAX_CONTENT),
      ok: ok && !thin,
      thin,
    };
  } catch (e) {
    return { note: `Could not reach ${url}: ${e.message}.`, content: '', ok: false, thin: true };
  }
}

const SYSTEM = `You are MARKOV, a rigorous product reviewer that evaluates websites, APIs, MCP servers and skill files for builders on askbots. Builders rate every answer thumbs up or down; only specific, useful, HONEST feedback earns a thumbs up. Fabricated or generic feedback earns a thumbs down.

Rules:
- Ground every claim in a concrete detail actually present in the provided content (a heading, a nav item, an endpoint, a tool name, an error message, a sentence). Never invent features or pages.
- For freeform answers: LEAD with the single most important issue, then at most two more, each ranked and each paired with one concrete, specific fix. Skip filler and praise-padding. 1-4 sentences.
- Be calibrated and honest on ratings. Most real products are a 5-8. Reserve 9-10 for genuinely excellent, 1-3 for broken.
- If REACHABILITY says the property could not be fully accessed, say so plainly, review only what IS observable (the URL, the project description, the questions, any partial content), keep ratings conservative/neutral, and never fabricate observations. Honesty about access beats a made-up review.
- Match each answer to its question type exactly.

Return ONLY a JSON object of this exact shape:
{"answers": {"<questionId>": <answer>, ...}}
Value format by question "type":
- "rating": an integer 1-10 (number or numeric string).
- "freeform": a specific, concrete string referencing real details.
- "multiple_choice": exactly one string from the provided choices, verbatim.
- "multiselect": an array of one or more strings, each verbatim from the provided choices.
Answer EVERY question. No extra keys, no commentary outside the JSON.`;

function buildUser(project, prop) {
  const questions = (project.questions || []).map((q) => {
    const base = { id: q.id, type: q.type, text: q.text };
    if (q.choices) base.choices = q.choices;
    return base;
  });
  const reachability = prop.ok
    ? 'REACHABILITY: property fetched successfully — review the content directly.'
    : 'REACHABILITY: property could NOT be fully accessed (unreachable, blocked, or near-empty). Be honest about this, review only what is observable, keep ratings conservative, do not fabricate.';
  return [
    `PROJECT: ${project.name || '(unnamed)'}`,
    `PROPERTY TYPE: ${project.propertyType}`,
    `PROPERTY URL: ${project.propertyUrl}`,
    `FETCH NOTE: ${prop.note}`,
    reachability,
    '',
    'PROPERTY CONTENT (may be truncated):',
    prop.content ? prop.content : '(no content retrieved)',
    '',
    'QUESTIONS (answer every one, keyed by id):',
    JSON.stringify(questions, null, 2),
  ].join('\n');
}

// --- answer validation / coercion -----------------------------------------
function coerceRating(v) {
  let n = typeof v === 'number' ? v : parseInt(String(v).match(/-?\d+/)?.[0] ?? '', 10);
  if (!Number.isFinite(n)) n = 6;
  n = Math.max(1, Math.min(10, Math.round(n)));
  return String(n);
}

function nearestChoice(v, choices) {
  if (!choices || !choices.length) return String(v ?? '');
  const s = String(v ?? '').trim().toLowerCase();
  const exact = choices.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  const partial = choices.find((c) => c.toLowerCase().includes(s) || s.includes(c.toLowerCase()));
  return partial || choices[0];
}

function coerceMultiselect(v, choices) {
  let arr = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { arr = v.split(/[,;]+/); }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const mapped = arr.map((x) => nearestChoice(x, choices));
  const unique = [...new Set(mapped)].filter(Boolean);
  const valid = choices && choices.length ? unique.filter((c) => choices.includes(c)) : unique;
  const out = valid.length ? valid : (choices && choices.length ? [choices[0]] : unique);
  // askbots expects a JSON array *string* for multiselect answers.
  return JSON.stringify(out);
}

// Build the final answers array in the API's expected shape, validating every
// question so we never submit a malformed body (which would 400 and waste a slot).
export function coerceAnswers(project, raw) {
  const map = raw && raw.answers && typeof raw.answers === 'object' ? raw.answers : (raw || {});
  const answers = [];
  for (const q of project.questions || []) {
    let val = map[q.id];
    switch (q.type) {
      case 'rating':
        val = coerceRating(val);
        break;
      case 'multiple_choice':
        val = nearestChoice(val, q.choices);
        break;
      case 'multiselect':
        val = coerceMultiselect(val, q.choices);
        break;
      case 'freeform':
      default: {
        val = (val == null ? '' : String(val)).trim();
        if (val.length < 3) {
          val = `Reviewed ${project.propertyUrl}. Could not form a specific observation for "${q.text}" from the available content; would verify this directly against the live product.`;
        }
        break;
      }
    }
    answers.push({ questionId: q.id, answer: val });
  }
  return answers;
}

// Full pipeline: fetch property -> generate -> validate. Returns
// { answers, provider, note, reachable }.
export async function generateAnswers(project) {
  const prop = await fetchProperty(project);
  const { data, provider } = await generateJSON(SYSTEM, buildUser(project, prop));
  const answers = coerceAnswers(project, data);
  return { answers, provider, note: prop.note, reachable: prop.ok };
}
