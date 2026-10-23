# Gates: deltos go-port phase 2 (core domain)

OWNS: server-go/**

Scope: port the core domain of the Node server to Go (bootstrap, projects, labels, users, tasks, subtasks, comments, activity, attachments, trash, search, export, settings, admin audit, HA integration, SSE hub, idempotency, keyset pagination, minimal recurrence) with the same HTTP contract, tests and CI green.

- [ ] G1: phase-2 router registers exactly the TypeScript route set (minus deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase2/scripts/verify-routes.mjs
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

- [ ] G4: SSE hub emits named events, monotonic ids and resync on missed events
  CHECK: go test ./internal/sse -race -count=1 -v && echo SSE_OK
  CWD: server-go
  EXPECT: SSE_OK
  EVIDENCE: pending

- [ ] G5: idempotency middleware caches 2xx POSTs and replays within 24h
  CHECK: go test ./internal/idempotency -race -count=1 -v && echo IDEMPOTENCY_OK
  CWD: server-go
  EXPECT: IDEMPOTENCY_OK
  EVIDENCE: pending

- [ ] G6: keyset pagination round-trips cursors and rejects malformed ones
  CHECK: go test ./internal/keyset -race -count=1 -v && echo KEYSET_OK
  CWD: server-go
  EXPECT: KEYSET_OK
  EVIDENCE: pending

- [ ] G7: attachments enforce allowlist MIME, size limit and per-task cap
  CHECK: go test ./internal/api -run TestAttachments -race -count=1 -v && echo ATTACHMENTS_OK
  CWD: server-go
  EXPECT: ATTACHMENTS_OK
  EVIDENCE: pending

- [ ] G8: HA token flow issues bearer tokens, stores only SHA-256 and serves the todo list
  CHECK: go test ./internal/api -run TestHA -race -count=1 -v && echo HA_OK
  CWD: server-go
  EXPECT: HA_OK
  EVIDENCE: pending

- [ ] G9: binary smoke: login, create project+task, move to done creates recurring next instance, SSE receives task.changed
  CHECK: go test ./internal/integration -run TestPhase2Smoke -race -count=1 -v && echo SMOKE2_OK
  CWD: server-go
  EXPECT: SMOKE2_OK
  EVIDENCE: pending
