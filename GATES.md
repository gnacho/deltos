# Gates: deltos go-port phase 4 (decisions + gamification)

OWNS: server-go/**

Scope: port the advice-process decision module and the gamification ledger to Go (solutions, advisory votes, choose/reopen/close, decision attachments, points ledger inside transactions with reversals, rewards and redemptions) with the same HTTP contract, tests and CI green.

- [x] G1: phase-4 router registers exactly the TypeScript route set (minus deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase4/scripts/verify-routes.mjs
  EXPECT: routes verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=e957a0d75e1cea273394add757122cd6fd9893d2bf3af349f214ed844b7315e5; exit=0; EXPECT=matched; output-sha256=820600775c6ec8f63f2d1f11970f23a60b44478e7bac7f177885b3910946155e; output-bytes=56; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4; path=fdeacba6533b/18 entries

- [x] G2: full Go test suite passes with race detector
  CHECK: go test ./... -race -count=1 && echo RACE_OK
  CWD: server-go
  EXPECT: RACE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=53c94f2a0ffc9e7aef7b9766e4a87bd9b8aa5f9efcab3787931d47c601ae49bf; exit=0; EXPECT=matched; output-sha256=d6e098334924e9bb1f59d9ffa7945d311755bfeaf5a70187231e04a87fa5bc45; output-bytes=1006; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G3: go vet and staticcheck report no findings
  CHECK: go vet ./... && /home/nacho/go/bin/staticcheck ./... && echo LINT_OK
  CWD: server-go
  EXPECT: LINT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=f4ab1ffb450cfc45ad31fac86a0c0c703f915397e4cc64b26b08e6371e66f8a3; exit=0; EXPECT=matched; output-sha256=00f8027709ba969248ef1de221d355e95291fe77a63021b526a7db106e9f1f09; output-bytes=8; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G4: decision lifecycle matches the contract (create, edit, solutions, votes, choose/reopen/close-without-solution, comments, activity)
  CHECK: go test ./internal/api -run TestDecisionLifecycle -race -count=1 -v && echo DECISION_OK
  CWD: server-go
  EXPECT: DECISION_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=b1d89c61551e0ff26567261ccddd8f4a5047050e8adbc1ee66c77f16218bb928; exit=0; EXPECT=matched; output-sha256=6c83b52499de7fb462aba98dedb64838bf077aba6441c125c30a4a940be34e0c; output-bytes=5779; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G5: decision attachments (description-level and solution-level) enforce permissions and limits
  CHECK: go test ./internal/api -run TestDecisionAttachments -race -count=1 -v && echo DECATT_OK
  CWD: server-go
  EXPECT: DECATT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ad2b6433edbf7ba32b765bf032fd5f6b162529325f736e933abfb4476453b078; exit=0; EXPECT=matched; output-sha256=0a0215b8b70018003e3febb6006315611f8516d77e2fb55e93d6f76b37c3e8d9; output-bytes=6334; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G6: gamification ledger grants/reverts points inside transactions (+8 chosen, +1 vote, once-per-decision, unvote/reopen reversals, 23h anti-farming)
  CHECK: go test ./internal/api -run TestGamification -race -count=1 -v && echo GAMIFICATION_OK
  CWD: server-go
  EXPECT: GAMIFICATION_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=375b7c60b385278fc61a7e5d42868302880885e1f15804f56742289c6288502c; exit=0; EXPECT=matched; output-sha256=ebecebe64cf71f22b8bdc72e016e08de353332ee9da6433e33829fdb69458c7c; output-bytes=20166; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G7: rewards and redemptions (cost at redemption time, active=0 soft delete, insufficient points)
  CHECK: go test ./internal/api -run TestRewards -race -count=1 -v && echo REWARDS_OK
  CWD: server-go
  EXPECT: REWARDS_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=6e558e7cb379d621038e5b276620ac65e5eff42b06e6918560c8902561b5ed78; exit=0; EXPECT=matched; output-sha256=6f30acebbc40a6ff4567db3118ee5650a4df1a7d80bfc14057a8e81c4526654a; output-bytes=5280; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries

- [x] G8: binary smoke: decision voted+chosen emits decision.changed and gamification.changed over SSE, ledger rows correct
  CHECK: go test ./internal/integration -run TestPhase4Smoke -race -count=1 -v && echo SMOKE4_OK
  CWD: server-go
  EXPECT: SMOKE4_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=35a1429ae8f96cca0887087522166ad6b4baa213a5537d5610486db405e3020f; exit=0; EXPECT=matched; output-sha256=b67d6e0a911d06d2ecd815fc6508de3936a0ddff474c75897e95018251437102; output-bytes=4158; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase4/server-go; path=fdeacba6533b/18 entries
