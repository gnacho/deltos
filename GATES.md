# Gates: deltos go-port phase 6 (push + demo + backup + update + recover)

OWNS: server-go/**

Scope: port the external boundaries and ops to Go (Web Push with VAPID, i18n, quiet hours and queue; demo seed and login; backup run/restore; self-update status/progress/apply; recover admin localhost-only) and connect the digest delivery, with tests and CI green.

- [ ] G1: router achieves full route parity with the TypeScript server (nothing deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase6/scripts/verify-routes.mjs
  EXPECT: routes verification passed
  EVIDENCE: pending

- [ ] G2: full Go test suite passes with race detector
  CHECK: go test ./... -race -count=1 && echo RACE_OK
  CWD: server-go
  EXPECT: RACE_OK
  EVIDENCE: pending

- [ ] G3: go vet and staticcheck report no findings
  CHECK: go vet ./... && /home/nacho/go/bin/staticcheck ./... && echo LINT_OK
  CWD: server-go
  EXPECT: LINT_OK
  EVIDENCE: pending

- [ ] G4: push subscribe/unsubscribe, send with test VAPID keys, quiet-hours queue consolidation and 404/410 purge
  CHECK: go test ./internal/push -race -count=1 -v && echo PUSH_OK
  CWD: server-go
  EXPECT: PUSH_OK
  EVIDENCE: pending

- [ ] G5: push routes (prefs, quiet hours, test push, vapid public key) behave like the Node
  CHECK: go test ./internal/api -run TestPushRoutes -race -count=1 -v && echo PUSHROUTES_OK
  CWD: server-go
  EXPECT: PUSHROUTES_OK
  EVIDENCE: pending

- [ ] G6: demo seed is idempotent, demo login works and demo sessions are read-only
  CHECK: go test ./internal/api -run TestDemo -race -count=1 -v && echo DEMO_OK
  CWD: server-go
  EXPECT: DEMO_OK
  EVIDENCE: pending

- [ ] G7: backup creates a dump and restores into a clean database with the same schema and row counts
  CHECK: go test ./internal/backup -race -count=1 -v && echo BACKUP_OK
  CWD: server-go
  EXPECT: BACKUP_OK
  EVIDENCE: pending

- [ ] G8: update status against a fake GitHub API, progress file read and apply flag written with admin audit
  CHECK: go test ./internal/api -run TestUpdate -race -count=1 -v && echo UPDATE_OK
  CWD: server-go
  EXPECT: UPDATE_OK
  EVIDENCE: pending

- [ ] G9: recover admin endpoint works from localhost only and resets admin passwords
  CHECK: go test ./internal/api -run TestRecover -race -count=1 -v && echo RECOVER_OK
  CWD: server-go
  EXPECT: RECOVER_OK
  EVIDENCE: pending

- [ ] G10: binary smoke: demo login, push prefs saved, backup run via endpoint, digest delivery wired to real push
  CHECK: go test ./internal/integration -run TestPhase6Smoke -race -count=1 -v && echo SMOKE6_OK
  CWD: server-go
  EXPECT: SMOKE6_OK
  EVIDENCE: pending
