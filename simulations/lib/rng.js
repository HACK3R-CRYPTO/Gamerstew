// Deterministic PRNG (mulberry32) so every simulation run is reproducible.
// Same seed → same numbers → anyone can verify the published results.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller, driven by a mulberry32 stream.
function makeGaussian(rand) {
  let spare = null;
  return function (mean = 0, sd = 1) {
    if (spare !== null) { const v = spare; spare = null; return mean + sd * v; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return mean + sd * u * mul;
  };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    mean: Math.round(mean * 100) / 100,
    p10: percentile(s, 0.10),
    median: percentile(s, 0.50),
    p90: percentile(s, 0.90),
    min: s[0],
    max: s[s.length - 1],
  };
}

module.exports = { mulberry32, makeGaussian, stats };
