# Exact-source owner propagation path

Base: official openclaw/openclaw tag v2026.9.4, commit 3a9d69db306cd7f081e06254cb89c4bcc14a7107.
Line references below describe unpatched upstream; CI binds original and patched hashes separately.

1. Channel ingress produces channel/account and sender facts; command authorization is owned by src/auto-reply/command-auth.ts (owner policy and sender candidates at 500-536). Existing identity/scope resolution remains unchanged.
2. src/auto-reply/reply/commands-context.ts:55 places auth.senderIsOwner on command context. get-reply-run-execute.ts:517 carries command.senderIsOwner into the queued run, and agent-runner-run-params.ts:156 forwards it into current-run sender parameters.
3. agent-runner-embedded-candidate.ts composes these run/sender parameters. Embedded lifecycle run-orchestrator.ts:459 builds the shared context; :470 calls buildAgentHookContextChannelFields(params). It calls before_agent_reply before entering the prepared model loop.
4. run/setup.ts:113-122 invokes before_model_resolve using that context before resolving the runtime model. It catches hook exceptions: exceptions are NOT a block contract. Locked model selection can bypass this hook.
5. run/run-attempt-dispatch.ts:420 forwards the existing sender owner decision to each attempt. The patch additionally preserves the existing lane fact so a subagent-only restriction cannot disappear after early routing.
6. run/attempt-prompt-build.ts:157 builds attempt hook context from the attempt parameters. run/attempt-before-agent-run.ts:91-102 dispatches before_agent_run: upstream event already had senderIsOwner, but upstream PluginHookAgentContext did not. This is the confirmed original gap.
7. CLI uses the same shared channel context helper and the harness context serializer. Command CLI forwarding gains the existing bootstrapContextRunKind fact, because restored cron continuations may have trigger=user.
8. Patch adds a pure current-run owner projection, optional public context field, consistent embedded/CLI event projection, guarded harness serialization, and docs/tests. No allowlist recalculation, requester-ID invention, username matching, session-owner parsing, or global owner cache.

## Inheritance and acceptance boundary

See INHERITANCE-AUDIT.md. Undefined is UNKNOWN, never owner. System, heartbeat, cron/recovery, inter-session and child runs do not inherit owner authority. Existing command/tool permissions are unchanged.

Native Codex upstream builds an explicit subset and lacks a before_agent_run invocation. The candidate forwards full run facts before normalized channel overrides, then checks the lifecycle gate before every turn/start RPC, including retries. Policy blocks retain hook:before_agent_run terminal provenance and safe public messages; they do not become provider availability failures. Model diagnostic start and llm_input occur only after admission, once per attempt.

The exact native dependency is @openai/codex 0.153.4. Official rust-v0.153.4 tag resolves to 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a. Its codex-rs/core/src/hook_runtime.rs UserPromptSubmit boundary was inspected; it is distinct from OpenClaw lifecycle hooks. No native Codex source patch is required or bundled.

Router independently rechecks current-run selection and model identity at before_agent_run. Missing same-run decision, unknown effective model, or absent owner for genuine emergency blocks submission. Locked-selection bypasses cannot silently proceed. Native-owned/supervision paths without authoritative model identity are conservatively blocked. CI must prove these properties; source review is not a runtime PASS.
