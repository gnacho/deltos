// Verify the Go router registers the complete TypeScript route set. Sources:
// app.ts (auth endpoints + events + version + update) and every routes-*.ts.
// Go routes are registered with chi method helpers (r.Get("/api/...")) and
// with MethodFunc for the auth endpoints kept out of older comparisons.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsFiles = [
  `${root}/server/src/app.ts`,
  `${root}/server/src/routes-domain.ts`,
  `${root}/server/src/routes-ha.ts`,
  `${root}/server/src/routes-expenses.ts`,
  `${root}/server/src/routes-invite.ts`,
  `${root}/server/src/routes-decisions.ts`,
  `${root}/server/src/routes-gamification.ts`,
  `${root}/server/src/routes-push.ts`,
];
const goFiles = [
  `${root}/server-go/internal/api/server.go`,
  `${root}/server-go/internal/api/domain.go`,
  `${root}/server-go/internal/api/tasks.go`,
  `${root}/server-go/internal/api/ha.go`,
  `${root}/server-go/internal/api/expenses.go`,
  `${root}/server-go/internal/api/invite.go`,
  `${root}/server-go/internal/api/decisions.go`,
  `${root}/server-go/internal/api/gamification.go`,
  `${root}/server-go/internal/api/push.go`,
  `${root}/server-go/internal/api/update.go`,
];

const tsRe = /\.(get|post|put|delete|patch)\(\s*['"`](\/api\/[^'"`\s?]+)['"`]/g;
const goRe = /\.(Get|Post|Put|Delete|Patch)\(\s*"(\/api\/[^"]+)"/g;
const goMethodFuncRe = /\.MethodFunc\(http\.Method([A-Za-z]+),\s*"(\/api\/[^"]+)"/g;

function collect(text, re, keyed) {
  const set = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    set.add((keyed ? keyed(m) : m[1].toUpperCase()) + ' ' + m[2]);
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
    const t = readFileSync(f, 'utf8');
    for (const item of collect(t, goRe)) goSet.add(item);
    for (const item of collect(t, goMethodFuncRe, (m) => m[1].toUpperCase())) goSet.add(item);
  } catch {
    // file not present yet: counts as missing routes
  }
}

// Go-side additions that the Node server does not have (documented).
const goOnly = new Set(['/api/auth/recover']);

const missingInGo = [...tsSet].filter(r => !goSet.has(r) && !goOnly.has(r.split(' ')[1]));
const unexpected = [...goSet].filter(r => !tsSet.has(r) && !goOnly.has(r.split(' ')[1]));

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
console.log(`routes verification passed (${tsSet.size} routes + ${goOnly.size} documented addition, full parity)`);
