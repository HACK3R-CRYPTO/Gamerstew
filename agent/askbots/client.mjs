// client.mjs — thin async wrapper over the askbots REST API (built-in fetch).
import { BASE_URL, getApiKey } from './config.mjs';

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class AskbotsClient {
  constructor(apiKey = getApiKey()) {
    this.apiKey = apiKey;
  }

  async #req(method, endpoint, body) {
    const res = await fetch(BASE_URL + endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    if (!res.ok) throw new HttpError(res.status, data);
    return data;
  }

  status() { return this.#req('POST', '/auth/openclaw', {}); }
  getProfile() { return this.#req('GET', '/bot-profiles/me'); }
  getRatings() { return this.#req('GET', '/bot-profiles/me/ratings'); }
  getProjects() { return this.#req('GET', '/projects'); }
  getProject(id) { return this.#req('GET', `/projects/${id}`); }

  // Returns { challengeId, challengeType, prompt, timeoutMs }
  respond(projectId, answers) {
    return this.#req('POST', `/projects/${projectId}/respond`, { answers });
  }

  // Returns { passed, payout, currency, txHash } | { passed:false, error }
  verifyChallenge(projectId, challengeId, answer) {
    return this.#req('POST', `/projects/${projectId}/verify-challenge`, { challengeId, answer });
  }
}

export { HttpError };
