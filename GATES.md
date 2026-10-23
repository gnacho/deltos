# Gates: deltos go-port phase 5 (NLP + full recurrence + digest)

OWNS: server-go/**

Scope: port the natural-language task parser, the complete adaptive recurrence engine and the daily due digest to Go, unlock POST /api/tasks/parse and GET /api/tasks/recurring, with tests replicating the TypeScript engine behavior case by case and CI green.

- [ ] G1: phase-5 router registers exactly the TypeScript route set (minus deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase5/scripts/verify-routes.mjs
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

- [ ] G4: NLP parser extracts due dates and recurrence from Spanish and English text (table tests from the Node cases)
  CHECK: go test ./internal/nlp -race -count=1 -v && echo NLP_OK
  CWD: server-go
  EXPECT: NLP_OK
  EVIDENCE: pending

- [ ] G5: recurrence engine matches the TypeScript for monthly/yearly/weekly/weekdays, end-of-month and adaptive-by-median cases
  CHECK: go test ./internal/recurrence -race -count=1 -v && echo RECURRENCE_OK
  CWD: server-go
  EXPECT: RECURRENCE_OK
  EVIDENCE: pending

- [ ] G6: GET /api/tasks/recurring returns the listing with next occurrence and pause state like the Node
  CHECK: go test ./internal/api -run TestRecurringListing -race -count=1 -v && echo RECURRING_OK
  CWD: server-go
  EXPECT: RECURRING_OK
  EVIDENCE: pending

- [ ] G7: digest due-tomorrow/today/overdue calculation matches the Node
  CHECK: go test ./internal/digest -race -count=1 -v && echo DIGEST_OK
  CWD: server-go
  EXPECT: DIGEST_OK
  EVIDENCE: pending

- [ ] G8: binary smoke: parse natural text -> create recurring task -> recurring listing shows next occurrence
  CHECK: go test ./internal/integration -run TestPhase5Smoke -race -count=1 -v && echo SMOKE5_OK
  CWD: server-go
  EXPECT: SMOKE5_OK
  EVIDENCE: pending
