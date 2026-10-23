# Gates: deltos go-port phase 3 (expenses + invites)

OWNS: server-go/**

Scope: port the expense plugin and invitation flows to Go (expense kanban with splits and settlement, expense comments/activity/attachments, public invite accept/reject/pay flows with hash-only tokens, expense trash) with the same HTTP contract, tests and CI green.

- [x] G1: phase-3 router registers exactly the TypeScript route set (minus deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase3/scripts/verify-routes.mjs
  EXPECT: routes verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1f3aa30f6f7042506312bd28a91b9ab1c38987d10bf4ce5580c3c9a8c49d347; exit=0; EXPECT=matched; output-sha256=3e455a54ca9b202c0154cc5947cb90858f61a41e3882d594a4c32c18ffcccc1d; output-bytes=56; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3; path=fdeacba6533b/18 entries

- [x] G2: full Go test suite passes with race detector
  CHECK: go test ./... -race -count=1 && echo RACE_OK
  CWD: server-go
  EXPECT: RACE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=53c94f2a0ffc9e7aef7b9766e4a87bd9b8aa5f9efcab3787931d47c601ae49bf; exit=0; EXPECT=matched; output-sha256=aa4603a6779494d3fb5bdc4c8be4bcefcf93c9cc4d302715440237c19f9d8ec8; output-bytes=1006; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G3: go vet and staticcheck report no findings
  CHECK: go vet ./... && /home/nacho/go/bin/staticcheck ./... && echo LINT_OK
  CWD: server-go
  EXPECT: LINT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=f4ab1ffb450cfc45ad31fac86a0c0c703f915397e4cc64b26b08e6371e66f8a3; exit=0; EXPECT=matched; output-sha256=00f8027709ba969248ef1de221d355e95291fe77a63021b526a7db106e9f1f09; output-bytes=8; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G4: expense lifecycle matches the contract (create, splits, moves, settle, comments, activity)
  CHECK: go test ./internal/api -run TestExpenseLifecycle -race -count=1 -v && echo EXPENSE_OK
  CWD: server-go
  EXPECT: EXPENSE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c67524e9b1cfada3836dca987a5be6e550c0da6908eb58d81b900a6667109ffd; exit=0; EXPECT=matched; output-sha256=9f1c7a914559dce2f1e9dcbef05009a90f1745bf9d62acede93f95daba2f2c4c; output-bytes=24264; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G5: invite flow works with hash-only tokens and public comment/pay routes
  CHECK: go test ./internal/api -run TestInvite -race -count=1 -v && echo INVITE_OK
  CWD: server-go
  EXPECT: INVITE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=383a3f21deb034d9ae63358aa76efbd9ade36c1336e386b294ce064573fe884e; exit=0; EXPECT=matched; output-sha256=0eb61a05164d79fe26f822238d518a269f2fcf84c6135a85c6a8f29b8f9755c1; output-bytes=11135; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G6: expense attachments enforce the same allowlist/limits as task attachments
  CHECK: go test ./internal/api -run TestExpenseAttachments -race -count=1 -v && echo EXPATT_OK
  CWD: server-go
  EXPECT: EXPATT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=3a5d67edc520fea97661348eec4f8670ee976a0511c77e8238266ecae22450c5; exit=0; EXPECT=matched; output-sha256=8f74a5f61321b1e28a6a4443f52061ae953c8685bdcf6bf08d0f591b382bfc25; output-bytes=6073; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G7: expense trash (list/restore/purge) behaves like the Node server
  CHECK: go test ./internal/api -run TestExpenseTrash -race -count=1 -v && echo EXPTRASH_OK
  CWD: server-go
  EXPECT: EXPTRASH_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d118b44289bcf9d4d5ff2dc4acd958c736694e3ceff00a735e4ad0be4b1bc8d0; exit=0; EXPECT=matched; output-sha256=35d9a35966f9e207f588bd326bcbad7067c0248ff428828c50f2d63f9e9e0053; output-bytes=7863; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries

- [x] G8: binary smoke: expense kanban move broadcasts expense.changed over SSE and invite link accepts
  CHECK: go test ./internal/integration -run TestPhase3Smoke -race -count=1 -v && echo SMOKE3_OK
  CWD: server-go
  EXPECT: SMOKE3_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=3c832885546bffd2fc652b320060aa8a2ea9d67102e543fcca9730cf393c9f0d; exit=0; EXPECT=matched; output-sha256=f1ee62ecb7966d3fc092c4660d49b0072239c8410ad0c1d85ff630e4901d7ca5; output-bytes=3669; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase3/server-go; path=fdeacba6533b/18 entries
