// Verify the Go router registers exactly the phase-4 route set of the
// TypeScript server (all route files, minus the routes deferred to later
// phases).
import { readFileSync } from 'node:fs';

const root = '/home/nacho/temp/opencode-work/deltos-fase4';
const tsFiles = [
  `${root}/server/src/routes-domain.ts`,
  `${root}/server/src/routes-ha.ts`,
  `${root}/server/src/routes-expenses.ts`,
  `${root}/server/src/routes-invite.ts`,
  `${root}/server/src/routes-decisions.ts`,
  `${root}/server/src/routes-gamification.ts`,
];
const goFiles = [
  `${root}/server-go/internal/api/domain.go`,
  `${root}/server-go/internal/api/tasks.go`,
  `${root}/server-go/internal/api/ha.go`,
  `${root}/server-go/internal/api/expenses.go`,
  `${root}/server-go/internal/api/invite.go`,
  `${root}/server-go/internal/api/decisions.go`,
  `${root}/server-go/internal/api/gamification.go`,
  `${root}/server-go/internal/api/server.go`,
];

// Deferred to later phases (must NOT be in the Go set).
const deferred = new Set([
  '/api/tasks/parse', // phase 5 (NLP)
  '/api/tasks/recurring', // phase 5 (adaptive listing)
  '/api/settings/backup/run', // phase 6
]);

const tsRe = /\.(get|post|put|delete|patch)\(\s*['"`](\/api\/[^'"`\s?]+)['"`]/g;
const goRe = /\.(Get|Post|Put|Delete|Patch)\(\s*"(\/api\/[^"]+)"/g;

function collect(text, re) {
  const set = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    set.add(m[1].toUpperCase() + ' ' + m[2]);
  }
  return set;
}

const tsSet = new Set();
for (const f of tsFiles) {
  for (const item of collect(readFileSync(f, 'utf8'), tsRe)) tsSet.add(item);
}
const goSet = new Set();
for (const f of goFiles) {
  try {
    for (const item of collect(readFileSync(f, 'utf8'), goRe)) goSet.add(item);
  } catch {
    // file not present yet: counts as missing routes
  }
}

const missingInGo = [...tsSet].filter(r => !deferred.has(r.split(' ')[1]) && !goSet.has(r));
const unexpected = [...goSet].filter(r => !tsSet.has(r));

if (missingInGo.length) {
  console.error('FAIL: missing in Go:');
  for (const r of missingInGo.sort()) console.error('  ' + r);
  process.exit(1);
}
if (unexpected.length) {
  console.error('FAIL: registered in Go but not in TS:');
  for (const r of unexpected.sort()) console.error('  ' + r);
  process.exit(1);
}
const expected = [...tsSet].filter(r => !deferred.has(r.split(' ')[1])).length;
console.log(`routes verification passed (${expected} routes in phase-4 scope)`);
