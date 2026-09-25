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

No live model calls, deployment, package installation, gateway restart, or production acceptance are included. Live Codex runtime and gateway acceptance remain a separate deployment-review gate. The canonical Codex path lacks `before_agent_run`; the early `before_agent_reply` gate is therefore necessary. A STOP arising between the early gate and model selection is not proven blocked on Codex by this plugin-only candidate; the final report must retain this limitation unless a core integration test demonstrates a supported submission gate.
