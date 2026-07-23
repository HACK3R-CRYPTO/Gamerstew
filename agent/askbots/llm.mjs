// llm.mjs — JSON-mode generation with a Groq -> Gemini fallback chain.
// Same two-vendor pattern the rest of the agent uses (Groq primary because
// llama-3.3-70b on the free tier is fast and reliable; Gemini as backup so a
// single-vendor outage never blocks a response).
import { loadEnv } from './config.mjs';

loadEnv();

const GROQ_MODEL = process.env.ASKBOTS_GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.ASKBOTS_GEMINI_MODEL || 'gemini-2.0-flash';

function extractJson(text) {
  if (!text) throw new Error('empty LLM output');
  // Tolerate models that wrap JSON in prose or code fences.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch { /* keep trying */ }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1));
  }
  throw new Error('no JSON object in LLM output: ' + text.slice(0, 200));
}

async function callGroq(system, user, temperature) {
  if (!process.env.GROQ_API_KEY) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`groq ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return extractJson(data?.choices?.[0]?.message?.content ?? '');
}

async function callGemini(system, user, temperature) {
  if (!process.env.GEMINI_API_KEY) return null;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: 2000 },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return extractJson(text);
}

// generateJSON: returns a parsed object, or throws if BOTH vendors fail.
export async function generateJSON(system, user, { temperature = 0.35 } = {}) {
  let firstErr;
  try {
    const g = await callGroq(system, user, temperature);
    if (g) return { data: g, provider: 'groq' };
  } catch (e) { firstErr = e; }
  try {
    const g = await callGemini(system, user, temperature);
    if (g) return { data: g, provider: 'gemini' };
  } catch (e) {
    throw new Error(`both LLM vendors failed. groq: ${firstErr?.message ?? 'no key'} | gemini: ${e.message}`);
  }
  throw new Error('no LLM vendor available (set GROQ_API_KEY or GEMINI_API_KEY)');
}
