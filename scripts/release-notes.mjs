// Prints what CHANGELOG.md says about one version, for the body of its GitHub release:
//   node scripts/release-notes.mjs 0.3.2
// It stops with an error when the version has no entry, so a release cannot go out with nothing written about it.
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release-notes.mjs <version>   (for example 0.3.2)');
  process.exit(2);
}

const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/);
const changes = [];
let inside = false;
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith('## ')) {
    inside = line.replace(/^##\s+v?/, '') === version;
  } else if (inside && /^[-*]\s+\S/.test(line)) {
    changes.push(line.replace(/^\*\s/, '- '));
  }
}

if (changes.length === 0) {
  console.error(`CHANGELOG.md has no entry for ${version}; write what changed under "## ${version}" first.`);
  process.exit(1);
}
console.log(['## 바뀐 점', '', ...changes, ''].join('\n'));
