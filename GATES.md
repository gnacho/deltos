# Gates: deltos go-port phase 6 (push + demo + backup + update + recover)

OWNS: server-go/**

Scope: port the external boundaries and ops to Go (Web Push with VAPID, i18n, quiet hours and queue; demo seed and login; backup run/restore; self-update status/progress/apply; recover admin localhost-only) and connect the digest delivery, with tests and CI green.

- [x] G1: router achieves full route parity with the TypeScript server (nothing deferred)
  CHECK: node /home/nacho/temp/opencode-work/deltos-fase6/scripts/verify-routes.mjs
  EXPECT: routes verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=b343b58aacf3e4e56ca0eb694392d6d63e5f7c888938c268742814286b06aa58; exit=0; EXPECT=matched; output-sha256=a1b2f975f35577e55ecaa2fe0930ec805dbf32b0aad1e6e8f329df875bfa661a; output-bytes=53; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6; path=fdeacba6533b/18 entries

- [x] G2: full Go test suite passes with race detector
  CHECK: go test ./... -race -count=1 && echo RACE_OK
  CWD: server-go
  EXPECT: RACE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=53c94f2a0ffc9e7aef7b9766e4a87bd9b8aa5f9efcab3787931d47c601ae49bf; exit=0; EXPECT=matched; output-sha256=454a92c6e3c95ace89aa2967131c42526d490b551d16440fe090e64f3a6912eb; output-bytes=1467; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G3: go vet and staticcheck report no findings
  CHECK: go vet ./... && /home/nacho/go/bin/staticcheck ./... && echo LINT_OK
  CWD: server-go
  EXPECT: LINT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=f4ab1ffb450cfc45ad31fac86a0c0c703f915397e4cc64b26b08e6371e66f8a3; exit=0; EXPECT=matched; output-sha256=00f8027709ba969248ef1de221d355e95291fe77a63021b526a7db106e9f1f09; output-bytes=8; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G4: push subscribe/unsubscribe, send with test VAPID keys, quiet-hours queue consolidation and 404/410 purge
  CHECK: go test ./internal/push -race -count=1 -v && echo PUSH_OK
  CWD: server-go
  EXPECT: PUSH_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ec0ec966012fe3f1413383a1d1ccf63cfc1efa676dd1b4811ab955a0081549ba; exit=0; EXPECT=matched; output-sha256=af21d45bfecc3ee92ecdecddbc0520c25da14d1695cb41b3eae33df01e1c44eb; output-bytes=8267; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G5: push routes (prefs, quiet hours, test push, vapid public key) behave like the Node
  CHECK: go test ./internal/api -run TestPushRoutes -race -count=1 -v && echo PUSHROUTES_OK
  CWD: server-go
  EXPECT: PUSHROUTES_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=cd12c98cbf6503cde1f09379f22ea3d76779d37000e23c78605bfe85180e35eb; exit=0; EXPECT=matched; output-sha256=508e95bba2a06bd443bb3f81172bacce80300d68b0c1e7f82a73ed02dc31cf99; output-bytes=18995; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G6: demo seed is idempotent, demo login works and demo sessions are read-only
  CHECK: go test ./internal/api -run TestDemo -race -count=1 -v && echo DEMO_OK
  CWD: server-go
  EXPECT: DEMO_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=f629b0920af33175a5d65d76a1afc3cb3f8ae4e76d8fa4ebde116e9f0b4cae68; exit=0; EXPECT=matched; output-sha256=d5ca0deb9e0cf73dc783499726da2a724fa50f76fdbd4abc714c9bb3750f6665; output-bytes=8781; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G7: backup creates a dump and restores into a clean database with the same schema and row counts
  CHECK: go test ./internal/backup -race -count=1 -v && echo BACKUP_OK
  CWD: server-go
  EXPECT: BACKUP_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=4ec13491d8e0489cfd08ebfb11a99e38d5831c3f3abcce8e4e324a5900ad1ca8; exit=0; EXPECT=matched; output-sha256=4e59fd17156c654123d02ed567484e744447cf7f11830b21e13fbdae37548bc1; output-bytes=2305; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G8: update status against a fake GitHub API, progress file read and apply flag written with admin audit
  CHECK: go test ./internal/api -run TestUpdate -race -count=1 -v && echo UPDATE_OK
  CWD: server-go
  EXPECT: UPDATE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d245bafa4c15495516323e6c7ed7fba696f48c8a3846083d38493522a5306403; exit=0; EXPECT=matched; output-sha256=9ef60e73f5f5678f34116f8e46f58649ac7cd44fa2c918f5b61877cdb07cff43; output-bytes=12976; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G9: recover admin endpoint works from localhost only and resets admin passwords
  CHECK: go test ./internal/api -run TestRecover -race -count=1 -v && echo RECOVER_OK
  CWD: server-go
  EXPECT: RECOVER_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=eeff0422a09f07e5776534b8cbddc375b4be932a1c0eb7db3c00fbca48a45d34; exit=0; EXPECT=matched; output-sha256=03219b98831ce80bc27f505a90e44131e956125b7855b2471d3b0bf239c426fd; output-bytes=7370; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries

- [x] G10: binary smoke: demo login, push prefs saved, backup run via endpoint, digest delivery wired to real push
  CHECK: go test ./internal/integration -run TestPhase6Smoke -race -count=1 -v && echo SMOKE6_OK
  CWD: server-go
  EXPECT: SMOKE6_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=5133c21885acf27eea4ce30222be3102a9627976cc4cc9c23fdadebfcc82eb71; exit=0; EXPECT=matched; output-sha256=03be1ab55f0b35a6e06781d2d83da734ec42c333898eef87dfd365fe8a5933ae; output-bytes=4353; shell=/bin/sh; cwd=/home/nacho/temp/opencode-work/deltos-fase6/server-go; path=fdeacba6533b/18 entries
