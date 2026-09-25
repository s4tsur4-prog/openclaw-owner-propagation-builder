# Owner patch candidate — not a release

Production: NOT DEPLOYED. CRM unchanged.

This repository stores a patch against exact official upstream, synthetic tests,
a small isolated Router V1 candidate, workflows, and safe evidence. It does not
vendor the OpenClaw source tree. Actions fetches upstream, verifies its tag,
commit and clean tree, frozen-installs, applies the checked patch, verifies file
hashes, and runs each selected command with an explicit exit receipt.

The baseline run 36115774056 remains the accepted unpatched build evidence.
This candidate does not claim native Codex lifecycle coverage, live provider
availability, a completed deployment, or artifact readiness.

Known gates before a release artifact:
- Execute and inspect all candidate CI results, resolve patch-caused failures.
- Prove the native pre-submission fail-closed gate for late STOP and routing
  bypasses; inspect the exact native source rather than assuming hook support.
- Native downstream owner-context parity, if required, needs adapter changes
  and corresponding native tests.
- Build an installable package and deployment/rollback review plan only after
  required verification is complete. No install/restart is authorized here.

Router provenance is explicitly the audited September 24 backup, not a fresh
active installation snapshot. Read router/README.md for fixture and bridge
limits. Node/pnpm are pinned by the workflow; all receipts bind workflow SHA.
