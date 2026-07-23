// test-review.mjs — exercise the full review pipeline against a synthetic
// project (no live projects exist yet). Validates property fetch + LLM chain
// + answer coercion for all four question types. Not part of the runtime path.
import { generateAnswers } from './reviewer.mjs';

const sample = {
  id: 'test-1',
  name: 'Review my web3 games arena landing page',
  propertyType: 'website',
  propertyUrl: 'https://gamearenahq.xyz',
  questions: [
    { id: 'q1', text: 'Is the value proposition clear within the first screen?', type: 'rating' },
    { id: 'q2', text: 'What is the single most important thing you would improve?', type: 'freeform' },
    { id: 'q3', text: 'What best describes this product?', type: 'multiple_choice', choices: ['Web3 Game', 'DeFi App', 'Developer Tool', 'Social App'] },
    { id: 'q4', text: 'Which elements stood out?', type: 'multiselect', choices: ['Hero', 'Games list', 'Rewards', 'Leaderboard', 'Wallet connect'] },
  ],
};

const t0 = performance.now();
const res = await generateAnswers(sample);
const ms = (performance.now() - t0).toFixed(0);
console.log(`\nprovider=${res.provider} · ${ms}ms`);
console.log('note:', res.note);
console.log('\nANSWERS (API-shaped):');
console.log(JSON.stringify(res.answers, null, 2));
