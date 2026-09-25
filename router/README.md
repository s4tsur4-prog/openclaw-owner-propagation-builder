# Router V1 isolated owner-authority candidate

Source provenance: local 2026-09-24 owner-channelid backup, not a verified active installation snapshot. Original selected source-file SHA-256 values are in original-file-hashes.json. Only explicit source, manifest, package, and tests were selected; no state, config, logs, checkpoints, backups, credentials, or production databases were copied. Fixture sender IDs and names are synthetic.

## Repairs
- Current shared core context `senderIsOwner === true` is the only owner authority.
- Stored owner hashes are audit bindings only, never authorization for later runs.
- No session-key or parent/recovery cache provides authority.
- Binding identity comes only from context channel/account/sender, never event overrides.
- Emergency high-risk runs are handled before model resolution by `before_agent_reply` when current authority is false/unknown even with a healthy STOP store; existing STOP retains its specific reason and malformed STOP storage also fails closed there.
- Late blocks use run IDs only and are enforced by `before_agent_run` where supported.
- Failure classification preserves interruption/tool/delivery/finalization exclusions and selected-model correlation.

## Verification boundaries
No tests were run on the production host. CI must run `node --test test/*.test.js` and `node --check` on source files. The standalone lifecycle suite replaces only the SDK entry-definition wrapper with an identity helper and invokes captured hooks: it proves plugin logic, NOT canonical hook ordering or zero model submissions. A separate canonical patched-core orchestrator bridge must register these real handlers with the real hook runner and prove `before_agent_reply` handles non-owner/unknown stopped emergency runs before any attempt dispatch, while current-owner and normal runs continue.

No live model calls, deployment, package installation, gateway restart, or production acceptance are included. Live Codex runtime and gateway acceptance remain a separate deployment-review gate. The unpatched canonical Codex path lacks `before_agent_run`; this candidate requires the accompanying core native submission gate patch. The Router submission gate independently checks current emergency owner authority, exact same-run selection, and known matching effective route. Missing selections (including locked-model bypass) and unknown native-owned/supervision routes fail closed. In-scope CLI paths without a prior Router selection also block conservatively. Actual mismatches record `silent_fallback`, never senior-model-unavailable.

The native bridge `tests/run-attempt.router-owner.test.ts` must be copied into `extensions/codex/src/app-server` and run in that extension's Vitest suite with `OPENCLAW_ROUTER_TEST_DIR` set. It runs the actual native attempt caller with real registered Router handlers and synthetic RPC transport, checking owner selection admits turn/start and missing selection/mismatch/non-owner/unknown authority submits zero turn/start RPCs. Selection preloading is explicit; canonical orchestrator selection is proved in the separate orchestrator bridge. CI results, not this source draft, determine PASS.
