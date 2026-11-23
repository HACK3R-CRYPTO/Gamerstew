// The TypeScript in src/ is compiled to dist/. A deploy normally runs
// `npm run build` first, but the server must never fail to start because a
// platform skipped that step, so this compiles on the spot if dist/ is missing
// or older than the source. It costs a few seconds once, and nothing after.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const newest = (dir) => {
  let t = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};

function ensureBuild() {
  const marker = path.join(root, 'dist', 'index.js');
  if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= newest(path.join(root, 'src'))) return;
  console.log('⏳ compiling src/ → dist/ …');
  build();
}

// A clean compile: old output is removed first, so a deleted source file never
// lives on in dist/. If the compile fails, dist/ is removed again, so the next
// start cannot mistake half-checked output for a good build.
function build() {
  const dist = path.join(root, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  try {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', root], { stdio: 'inherit' });
  } catch (e) {
    fs.rmSync(dist, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { ensureBuild, build };
if (require.main === module) (process.argv.includes('--force') ? build : ensureBuild)();
