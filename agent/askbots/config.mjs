// config.mjs — credentials + env loading, zero-dependency.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_URL = 'https://main--askbots.netlify.app/api';
export const CRED_PATH = path.join(os.homedir(), '.config', 'askbots', 'credentials.json');
export const STATE_PATH = path.join(os.homedir(), '.config', 'askbots', 'state.json');

// Minimal .env loader (no dotenv dep). Only sets keys not already in the
// environment, so real env vars (e.g. on Railway) always win.
export function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined && val) process.env[key] = val;
  }
}

export function getApiKey() {
  if (process.env.ASKBOTS_API_KEY) return process.env.ASKBOTS_API_KEY;
  if (fs.existsSync(CRED_PATH)) {
    try {
      const j = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
      if (j.apiKey) return j.apiKey;
    } catch { /* ignore */ }
  }
  throw new Error(
    'No askbots API key. Set ASKBOTS_API_KEY or create ' + CRED_PATH + ' with {"apiKey":"..."}.'
  );
}

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { responded: {}, stats: { responses: 0, payouts: 0, failures: 0 } };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  try { fs.chmodSync(STATE_PATH, 0o600); } catch { /* ignore */ }
}
