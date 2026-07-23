// reviewer.mjs — turn a project + its property into high-quality, correctly
// typed answers. This is where the rating is won or lost: builders thumbs-up
// specific, grounded feedback and thumbs-down generic filler, so we always
// fetch the real property and force the model to cite concrete details.
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

// Best-effort retrieval of whatever the property actually is.
export async function fetchProperty(project) {
  const url = project.propertyUrl;
  const type = project.propertyType;
  if (!url) return { note: 'No propertyUrl provided.', content: '' };
  try {
    const r = await fetchText(url);
    let content;
    if (type === 'website') {
      content = /html/i.test(r.contentType) || /^\s*</.test(r.text) ? htmlToText(r.text) : r.text;
    } else if (type === 'skill_file') {
      content = r.text; // raw markdown/instructions
    } else if (type === 'api' || type === 'mcp_server') {
      content =
        `HTTP ${r.status} · content-type: ${r.contentType}\n` +
        (/html/i.test(r.contentType) ? htmlToText(r.text) : r.text);
    } else {
      content = /html/i.test(r.contentType) ? htmlToText(r.text) : r.text;
    }
    const truncated = content.length > MAX_CONTENT;
    return {
      note: `Fetched ${url} (HTTP ${r.status}, ${r.contentType || 'unknown type'})${truncated ? ', truncated' : ''}.`,
      content: content.slice(0, MAX_CONTENT),
    };
  } catch (e) {
    return { note: `Could not fetch ${url}: ${e.message}. Review from the URL and project context only.`, content: '' };
  }
}

const SYSTEM = `You are MARKOV, a rigorous product reviewer that evaluates websites, APIs, MCP servers and skill files for builders on askbots. Builders rate every answer thumbs up or down, and only specific, useful, honest feedback earns a thumbs up.

Rules:
- Ground every claim in a concrete detail actually present in the provided content (a heading, a nav item, an endpoint, an error message, a sentence). Never invent features.
- Be specific and actionable. "Improve the CTA" is useless; "the hero CTA reads 'Submit' with no value proposition — try 'Start earning USDT'" is useful.
- Be calibrated and honest. Do not inflate ratings. Most real products are a 5-8.
- Match each answer to its question type exactly.
- If the content could not be fetched, reason from the URL, project name and question wording, and say what you would check — never fabricate observations.

Return ONLY a JSON object of this exact shape:
{"answers": {"<questionId>": <answer>, ...}}
Where the value format depends on the question "type":
- "rating": an integer 1-10 (as a number or numeric string).
- "freeform": a specific, concrete string, 1-4 sentences, referencing real details.
- "multiple_choice": exactly one string from the provided choices, verbatim.
- "multiselect": an array of one or more strings, each verbatim from the provided choices.
Answer EVERY question. No extra keys, no commentary outside the JSON.`;

function buildUser(project, prop) {
  const questions = (project.questions || []).map((q) => {
    const base = { id: q.id, type: q.type, text: q.text };
    if (q.choices) base.choices = q.choices;
    return base;
  });
  return [
    `PROJECT: ${project.name || '(unnamed)'}`,
    `PROPERTY TYPE: ${project.propertyType}`,
    `PROPERTY URL: ${project.propertyUrl}`,
    `FETCH NOTE: ${prop.note}`,
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
// { answers, provider, note }.
export async function generateAnswers(project) {
  const prop = await fetchProperty(project);
  const { data, provider } = await generateJSON(SYSTEM, buildUser(project, prop));
  const answers = coerceAnswers(project, data);
  return { answers, provider, note: prop.note };
}
