// challenge.mjs — anti-human "rapid_math" solver.
//
// askbots sends a math prompt (e.g. "What is 847293 * 193847 + 582910384?")
// after every response and gives you 2 seconds to answer. Getting it right is
// what actually releases the $0.10 payout, so this has to be FAST and EXACT.
//
// Two hard rules:
//  1. NEVER eval() network input. This is a hand-written parser — no code
//     execution, no dependency, no injection surface.
//  2. Integer challenges are solved with BigInt so a huge product like
//     847293 * 193847 is exact, not a lossy float.

// Precedence table. '^'/'**' is right-associative, everything else left.
const PREC = { '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 4 };
const RIGHT_ASSOC = new Set(['^']);

// Pull the arithmetic out of a natural-language prompt. We drop every
// character that can't be part of an expression, which strips "What is",
// "Calculate", the trailing "?", etc. without needing to enumerate phrasings.
function extractExpression(prompt) {
  return String(prompt)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\bx\b/gi, '*')      // "3 x 4" style multiplication
    .replace(/\*\*/g, '^')         // normalize ** to ^
    .replace(/[^0-9.+\-*/()%^ ]/g, ' ')
    .trim();
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const isOp = (c) => c in PREC;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ') { i++; continue; }
    if (c === '(' || c === ')') { tokens.push(c); i++; continue; }
    if (isOp(c)) {
      // Detect unary minus/plus: an operator sign in a position where a value
      // is expected (start, after another operator, or after '('). Fold it
      // into the following number literal.
      const prev = tokens[tokens.length - 1];
      const unary = (c === '-' || c === '+') &&
        (prev === undefined || prev === '(' || (typeof prev === 'string' && prev in PREC));
      if (unary) {
        let j = i + 1;
        while (j < expr.length && expr[j] === ' ') j++;
        // unary in front of '(' -> represent as (0 - ...) by emitting 0 then op
        if (expr[j] === '(') {
          tokens.push('0');
          tokens.push(c);
          i = j;
          continue;
        }
        let num = c === '-' ? '-' : '';
        i = j;
        while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
        tokens.push(num);
        continue;
      }
      tokens.push(c);
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i++]; }
      tokens.push(num);
      continue;
    }
    // Unknown char — skip defensively.
    i++;
  }
  return tokens;
}

// Shunting-yard -> RPN.
function toRPN(tokens) {
  const out = [];
  const ops = [];
  for (const t of tokens) {
    if (t === '(') { ops.push(t); continue; }
    if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      ops.pop(); // discard '('
      continue;
    }
    if (t in PREC) {
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        (PREC[ops[ops.length - 1]] > PREC[t] ||
          (PREC[ops[ops.length - 1]] === PREC[t] && !RIGHT_ASSOC.has(t)))
      ) {
        out.push(ops.pop());
      }
      ops.push(t);
      continue;
    }
    out.push(t); // number
  }
  while (ops.length) out.push(ops.pop());
  return out;
}

function evalRPN(rpn, useBig) {
  const stack = [];
  const push = (v) => stack.push(v);
  const pop = () => stack.pop();
  for (const t of rpn) {
    if (!(t in PREC)) {
      push(useBig ? BigInt(t) : parseFloat(t));
      continue;
    }
    const b = pop();
    const a = pop();
    if (a === undefined || b === undefined) throw new Error('malformed expression');
    switch (t) {
      case '+': push(a + b); break;
      case '-': push(a - b); break;
      case '*': push(a * b); break;
      case '/':
        if (useBig) throw new Error('division in bigint path');
        push(a / b); break;
      case '%': push(a % b); break;
      case '^':
        if (useBig) {
          if (b < 0n) throw new Error('negative exponent in bigint path');
          if (b > 100000n) throw new Error('exponent too large');
          push(a ** b);
        } else {
          push(Math.pow(a, b));
        }
        break;
      default: throw new Error('unknown operator ' + t);
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced expression');
  return stack[0];
}

// Solve and return the answer as a plain string (no separators, no units).
export function solveChallenge(prompt) {
  const expr = extractExpression(prompt);
  if (!expr) throw new Error('no expression found in: ' + prompt);
  const tokens = tokenize(expr);
  const rpn = toRPN(tokens);

  // Pure-integer expression (no '.', no '/') -> exact BigInt. Otherwise Number.
  const isInteger = !expr.includes('.') && !expr.includes('/');
  if (isInteger) {
    try {
      const v = evalRPN(rpn, true);
      return v.toString();
    } catch {
      // fall through to Number path
    }
  }
  const v = evalRPN(rpn, false);
  if (Number.isInteger(v)) return String(v);
  // Trim floating noise but keep precision the grader likely expects.
  return String(Number(v.toFixed(6)));
}

// --- self test -------------------------------------------------------------
export function selfTest() {
  const cases = [
    ['What is 847293 * 193847 + 582910384?', 847293n * 193847n + 582910384n],
    ['What is 2 + 3 * 4?', 14n],
    ['What is (2 + 3) * 4?', 20n],
    ['Calculate 1000000 * 1000000 + 1', 1000000n * 1000000n + 1n],
    ['What is 100 - 30 - 20?', 50n],
    ['What is 2 ^ 10?', 1024n],
    ['What is 15 % 4?', 3n],
    ['What is 10 / 2 * 3?', 15],
    ['3 × 7', 21n],
    ['What is -5 + 12?', 7n],
    ['What is 9 * (4 + 6) - 2?', 88n],
  ];
  let pass = 0;
  for (const [prompt, expected] of cases) {
    const t0 = performance.now();
    let got;
    try { got = solveChallenge(prompt); } catch (e) { got = 'ERR:' + e.message; }
    const ms = (performance.now() - t0).toFixed(3);
    const ok = got === expected.toString();
    if (ok) pass++;
    console.log(`${ok ? '✓' : '✗'} ${ms}ms  "${prompt}" -> ${got}${ok ? '' : ` (expected ${expected})`}`);
  }
  console.log(`\n${pass}/${cases.length} passed`);
  return pass === cases.length;
}

// Allow: node askbots/challenge.mjs --selftest
// pathToFileURL handles spaces in the path (this repo lives under "code /").
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = selfTest();
  process.exit(ok ? 0 : 1);
}
