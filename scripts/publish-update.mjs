// publish-update.mjs — build a new DAWN version and publish it to the LOCAL
// offline update feed. Usage:
//   node scripts/publish-update.mjs            (auto-bumps the patch version)
//   node scripts/publish-update.mjs 0.2.0      (explicit version)
//
// After this runs, open DAWN → Settings → Updates → "Check now" and it will
// find and install the new version in place. Fully offline.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

// Resolve the new version (explicit arg or patch bump).
let version = process.argv[2];
if (!version) {
  const [a, b, c] = pkg.version.split('.').map((n) => parseInt(n, 10) || 0);
  version = `${a}.${b}.${c + 1}`;
}
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n▶ Building DAWN v${version} …\n`);

// Build the installer (+ latest.yml) into release/.
const env = { ...process.env, NODE_OPTIONS: '--use-system-ca' };
delete env.ELECTRON_RUN_AS_NODE;
execSync('npm run dist', { cwd: root, stdio: 'inherit', env });

// Publish artifacts to the local feed the installed app serves.
const feedDir = path.join(process.env.APPDATA, 'dawn', 'updates');
fs.mkdirSync(feedDir, { recursive: true });
const rel = path.join(root, 'release');

let copied = 0;
for (const f of fs.readdirSync(rel)) {
  const isThisVersion = f.includes(version) && (/\.exe$/.test(f) || /\.blockmap$/.test(f));
  if (f === 'latest.yml' || isThisVersion) {
    fs.copyFileSync(path.join(rel, f), path.join(feedDir, f));
    console.log(`  → ${f}`);
    copied++;
  }
}
// Prune installers from older versions so the feed stays small.
for (const f of fs.readdirSync(feedDir)) {
  if (/^DAWN-Setup-.*\.exe$/.test(f) && !f.includes(version)) fs.rmSync(path.join(feedDir, f), { force: true });
}

console.log(`\n✔ Published v${version} (${copied} files) to:\n   ${feedDir}\n`);
console.log('Open DAWN → Settings → Updates → "Check now" to install it.\n');
