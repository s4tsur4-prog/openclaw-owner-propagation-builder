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

Native downstream Codex context currently constructs an explicit subset and omits this new optional projection. The exact sibling Codex source is not available to certify its native lifecycle. The common pre-model and reply-claim gates are covered separately. Before-agent-run parity is claimed only for the embedded/CLI paths actually tested.

Router candidate uses current ctx.senderIsOwner only, and early before_agent_reply for supported triggers. A late STOP between the early gate and selection, undefined/unsupported trigger, or locked-model bypass still requires complete submission-gate proof before release readiness. Passing the candidate suites does not erase these gaps.
