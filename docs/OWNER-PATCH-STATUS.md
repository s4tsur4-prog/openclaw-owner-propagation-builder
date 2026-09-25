# Owner patch candidate — not a release

Production: NOT DEPLOYED. CRM unchanged.

This repository stores a patch against exact official upstream, synthetic tests,
a small isolated Router V1 candidate, workflows, and safe evidence. It does not
vendor the OpenClaw source tree. Actions fetches upstream, verifies its tag,
commit and clean tree, frozen-installs, applies the checked patch, verifies file
hashes, and runs each selected command with an explicit exit receipt.

The baseline run 36115774056 remains the accepted unpatched build evidence.
This candidate includes native Codex lifecycle coverage tests, still awaiting CI.
It does not claim live provider availability, deployment, or artifact readiness.

Known gates before a release artifact:
- Execute and inspect all candidate CI results, resolve patch-caused failures.
- Execute native pre-submission gate, owner parity, retry, cleanup and Router
  bridge regressions; the exact native dependency source audit is complete.
- Review conservative blocked paths: locked selection without same-run decision,
  model-unknown native-owned/supervision, and fresh messages in child sessions.
- Build an installable package and deployment/rollback review plan only after
  required verification is complete. No install/restart is authorized here.

Router provenance is explicitly the audited September 24 backup, not a fresh
active installation snapshot. Read router/README.md for fixture and bridge
limits. Node/pnpm are pinned by the workflow; all receipts bind workflow SHA.
