# Owner authority inheritance audit

Source: official OpenClaw commit `3a9d69db306cd7f081e06254cb89c4bcc14a7107` (`v2026.9.4`). Read-only source audit; no tests/build run on this host. All locations below refer to this exact upstream source. This is design evidence, not a test receipt.

## Findings

- Inbound owner resolution is per-message: `src/auto-reply/command-auth.ts:500` resolves owner policy with account/provider; `:512` computes sender candidates; `:530-536` grants only matched explicit owner identity or internal `operator.admin` scope. `:400` permits `From` fallback when there is no immutable sender field. `commands` admission is not equivalent to owner authority.
- `src/auto-reply/reply/get-reply-run-execute.ts:410-442` creates each followup run with current sender/account/channel facts and `command.senderIsOwner`; `agent-runner-run-params.ts:152-156` carries current provenance/owner to runtime. No session-level owner bit was found in session entry type definitions. Resuming the same session must not restore prior human authority.
- Queue isolation exists: `src/auto-reply/reply/queue/drain.ts:303-321` includes sender, channel context, and owner flag in authorization grouping; `:323-345` strips owner for verified mixed participants. Queue delivery keys include authorization key at `:364`. Do not replace these facts with cached hook/session state.
- Normal isolated cron `src/cron/isolated-agent/run-executor.ts:765-818` sets `trigger: "cron"` and `bootstrapContextRunKind: "cron"`, but omits sender owner. Cron creator/tool capabilities are separate authority and must not become a human-owner assertion.
- **Important pre-existing asymmetry:** recovered cron uses `src/gateway/agent-turn/agent-run-user-turn.ts:130-132`: restored cron implies `senderIsOwner=true`. This is not verified inbound human ownership. `agent-session-prepare.ts:153` marks it `bootstrapContextRunKind="cron"`; `agent-run-execution-phase.ts:389,410-411` forwards run kind/provenance/owner. Command execution nevertheless uses `trigger:"user"` (`src/agents/command/attempt-execution.ts:1058,1312`). A trigger-only hook projection is therefore insufficient.
- Heartbeat builds synthetic sender routing facts from allowFrom/delivery (`src/infra/outbound/targets.ts:724-754`) and supplies them as `From`/`To` with originating channel/account (`src/infra/heartbeat-runner-run.ts:74-102`). Existing command auth may match that synthetic sender to an owner because it has no internal-turn guard. However heartbeat runner marks `InternalTurnSource` and `internal_system` provenance and runtime reliably sets `trigger:"heartbeat"` (`agent-runner-embedded-candidate.ts:171`; `agent-runner-cli-candidate.ts:327,480`). Withhold projected owner for these turns regardless of raw params.
- Main restart recovery explicitly emits `inputProvenance.kind="internal_system"`, source tool `main_session_restart_recovery` (`src/agents/main-session-recovery/main-session-restart-dispatch.ts:543-547`). Unrelated/internal recovery cannot gain hook owner authority from a delivery target, old transcript, or recovery lease. Restart sentinel also has internal provenance (`src/gateway/server-restart-sentinel.ts:243-245`).
- Native subagent launch request has lane `subagent`, no human sender authority or input provenance (`src/agents/subagents/spawn/subagent-spawn-launch-request.ts:79-110`). Spawn routing forces a synthetic client (`subagent-spawn-gateway.ts:89-94`). Ordinary launch scope is write; special out-of-process model override can request admin (`:72-78`). Thus do not treat an admin transport scope alone as explicit human authority inheritance. Runtime carries spawnedBy through command toolContext (`src/agents/command/attempt-execution.ts:820`) into CLI (`:1138`) and embedded (`:1315`). Reject owner projection for spawned/internal runs; do not parse session keys.
- Local CLI intentionally defaults owner true (`src/agents/agent-command-local.ts:53`) under its trusted local command boundary. Public command ingress explicitly resets owner false (`agent-command-execution-identity.ts:227`). Preserve existing local operator semantics for direct runs; never introduce default true into the hook helper.
- Existing identity projection only rejects non-user triggers (`src/plugins/hook-agent-context.ts:129-140`). It does not presently handle owner authority/provenance and should not be mistaken for an authorization function.

## Recommended projection semantics

Retain existing tool/command capability behavior; add a narrow hook projection of already-resolved authority. Do not recalculate owner lists or inspect display names/session-key text.

1. Missing authority remains undefined. False remains false or is withheld on nonhuman turns, never true.
2. Allow true only for a direct user/local-operator turn with existing authoritative true, no internal/inter-session provenance, no cron/heartbeat run kind, and no child/internal-run lineage.
3. Withhold authority for non-user trigger; non-external provenance; cron/heartbeat bootstrap run kind; subagent lane/spawn lineage. These exclusions prevent synthetic scheduled/recovery transport authority being mislabeled as human owner.
4. Share this projection between `before_model_resolve` context and `before_agent_run` context/event; never let an event report raw true while its context withholds it.
5. Each call computes from immutable run-local facts. No module-global cache or previous/session owner lookup.
6. Fresh owner and non-owner messages to the same session use their own command decision. Channel/account isolation relies on the existing authoritative resolver and per-run identity, not routing target inference.

## Implementation gaps that tests must cover

- Command-origin CLI call at `src/agents/command/attempt-execution.ts:1048-1180` passes provenance, lane, and toolContext but does not forward bootstrapContextRunKind (embedded does at `:1369`). Forward this existing fact or project at a full-facts boundary before sparse CLI hook context; otherwise cron recovery CLI can leak true.
- `AgentHarnessHookContext` currently lacks owner and child/run-kind facts (`src/agents/harness/hook-context.ts:20-42`). Project while full facts exist or carry necessary facts through selection; testing only the helper cannot prove before-model behavior.
- A blanket spawnedBy exclusion is deliberately conservative: a later direct human message to an existing child session will remain unknown. It does not escalate privilege, but should be documented as a routing limitation if retained.
- Verify command-admitted subagents with admin transport/model override, cron recovery using trigger user, heartbeat with owner delivery target, inter-session handoff, and fresh same-session owner -> non-owner ordering. Include CLI and embedded lifecycle callers.
- Source inspection alone does not prove concurrent isolation or integration behavior. CI must execute all scenarios and record terminal exit codes before PASS.

## Fresh draft-patch review

The reviewed draft adds a pure owner projector, applies it in generic channel/harness context builders, normalizes embedded/CLI before-agent event bits, and forwards command CLI bootstrap run kind. Full-param generic orchestrator/CLI/embedded call sites now carry the intended conservative semantics. Execution is not verified by this review.

Outstanding native adapter boundary: `extensions/codex/src/app-server/run-attempt-context.ts:118` builds an explicit subset for the shared channel helper and omits both owner and guard facts. Forward full params before normalized channel overrides (or all six authority projection inputs) to avoid losing owner at that downstream context. A source search did not find a Codex `before_agent_run` invocation in the OpenClaw Codex adapter; `upstream-fork-boundary.ts:264` reads its blocked-result metadata. Therefore generic hook tests alone cannot certify native hook-event parity. The repository-required sibling `../codex` does not exist at the expected sibling checkout in this checkout environment; the exact native source must be inspected before a Codex-backed implementation verdict, and no claim of native end-to-end PASS is supported yet.

Conservative caveat: rejecting `spawnedBy` also withholds ownership for a genuinely fresh human turn in an existing child session, because session lineage is not itself the current sender. This cannot escalate permission but is an intentional limitation to document or replace with a more precise current child-run fact after evidence.
