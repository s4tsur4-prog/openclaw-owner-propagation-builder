# Review status — PREPARED, NOT AUTHORIZED FOR EXECUTION

Verification policy: VERIFICATION-POLICY-v2.md. Candidate88a818f49858753eecb02a28623c4d8fb574a939 remains immutable.

This controlled deployment/rollback plan is available for review. Before execution, final artifact SHA-256, provenance/receipt locations, actual installed runtime/launch paths, private backup path/hash, tested rollback command and owner-approved window must be filled from verified evidence. No artifact exists yet; these values must not be invented. Do not execute generic commands against assumed production paths.

STOP before production deployment for explicit final review. No installation, restart or production rehearsal is authorized by this document.

---

# Owner propagation candidate — deployment plan only

Production: NOT DEPLOYED. This document authorizes no installation, restart, routing change, or CRM work. Separate owner review and deployment approval is required after all replacement gates in VERIFICATION-POLICY-v2.md and packaging pass.

## Review before approval

- Pin the successful replacement-verification run/attempt and builder commit, exact upstream base 3a9d69db306cd7f081e06254cb89c4bcc14a7107, Node 24.21.0, pnpm 12.3.4, and both package and downloaded evidence ZIP SHA-256.
- Review source diff, original/patched hashes, changed-file list, command exits, targeted/native security results, full regression, and package contents. Bind every receipt to the exact candidate. Full upstream oxlint/pnpm check were not completed and must not be represented as PASS.
- This candidate includes core context projection, CLI propagation, native Codex pre-submission policy gate and Router audit-only owner binding. New runtime behavior must be accepted together; core-only installation does not prove Router compatibility.
- Package is not asserted offline-installable. Inspect its exact packaging receipt/dependency requirements on an isolated host. Never discover missing dependencies during a production replacement. Do not install from a moving branch or blindly edit compiled bundles.

## Production backup, prepared only after approval

1. Read current package prefix, launch unit/command, service user, runtime versions, config path, plugin path, environment references, Router mode/state and running PID/start time. Compare with pre-deployment receipt; reconcile drift before any write.
2. Acquire an operator change window and verify no other worker is modifying the install. Preserve existing unit/config/environment; do not overwrite them with builder settings.
3. Create a timestamped root/private backup of the complete previous installed runtime and dependency tree, launch metadata, Router plugin and its hashes, and relevant config/state. Keep secrets/config/owner data on the host with restrictive permissions; never upload them to the public builder.
4. Record backup SHA-256, permissions/ownership and restore commands against actual paths. Prove the previous binary can launch from a separate offline rollback copy. Treat a manifest-only backup or network reinstall as insufficient rollback.

## Installation plan

1. Download reviewed artifacts to a staging directory; recompute SHA-256 and reject mismatch. Verify file paths, symlinks, expected Codex bundle and workspace runtime dependencies before extraction.
2. Materialize a separate versioned install from the reviewed package. Resolve any required dependencies in an isolated staging environment using pinned inputs; record changes rather than claiming the tarball is dependency-complete.
3. Back up and stage the reviewed Router candidate separately if production Router differs; compare exact hashes. Preserve host config, credentials and state. The audit owner store is not an authority source.
4. Run staged version/import/startup checks before switching the actual service launch target. Switch only within the approved window; restart once and observe completion. A timeout is an unknown outcome: inspect service state/PID/log before retrying.

## Health and acceptance

- Verify service active, new PID/start time, exact installed version/hashes and expected launch target; verify gateway health, Telegram channel connectivity, hook loading, Router state and absence of duplicate workers.
- Send a fresh real owner Telegram message in the accepted account: before_model_resolve and before_agent_run must both receive current authoritative true. Confirm binding is written only from true; do not publish sender IDs or owner-store contents.
- Normal request selects/submits Sol; HIGH owner request selects/submits Astra. Receipt must show selected_model == effective_model and fallback false, not just provider availability.
- In controlled acceptance fixtures, owner -> non-owner -> unknown in the same resumed session must not carry true. Stale persisted binding must not authorize HIGH/emergency. Scheduled, recovery and child runs remain unknown unless documented core semantics explicitly establish authority.
- Confirm genuine senior-model unavailability stops the route; user abort, tool errors and delivery/finalization errors must not be mislabeled as model unavailable. Do not deliberately damage production credentials to test this; use isolated controlled failure fixtures and separately approved live smoke.
- Recheck config/state preservation and watch bounded logs after acceptance. Source/CI PASS is not live owner-persistence acceptance.

## Rollback

- Triggers: failed startup/health, missing hooks/adapter, owner leakage or unexpected denial, selected/effective mismatch, silent fallback, or unacceptable Router stop behavior.
- Stop the new instance in the approved window; restore the previous versioned runtime/dependencies and Router plugin from verified local backup; restore launch target/permissions, then restart once.
- Restore configuration only if changed by this deployment. Preserve messages and unrelated live state; do not overwrite databases/state wholesale from an older snapshot. Restore Router state only with an attributable change plan.
- Prove original hashes/runtime, service PID/start time, gateway/Telegram health and previous routing smoke. Record rollback outcome and keep the failed candidate quarantined from the live launch target.

## Known limits / remaining risks

- Conservative spawnedBy rejection also withholds ownership for a fresh human message in an existing child session.
- Local CLI operator semantics remain distinct from authenticated channel ownership.
- Native RPC tests use synthetic transport; no actual production model call, account entitlement or Telegram persistence is proved by CI.
- Package dependency materialization, package startup and deployment compatibility require isolated rehearsal and explicit deployment approval.
- Production and CRM Phase 3 remain untouched until separately approved.
