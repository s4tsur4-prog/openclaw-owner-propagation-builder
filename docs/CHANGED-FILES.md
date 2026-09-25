# Exact candidate source files

Base: 3a9d69db306cd7f081e06254cb89c4bcc14a7107

Hashes: patches/source-files.json. Native/core Router bridge fixtures are copied into the source by prepare and have separate hashes in tests/SHA256SUMS. Router original/patched manifests are under router/.

- `docs/plugins/architecture.md`
- `extensions/codex/src/app-server/before-agent-run.ts`
- `extensions/codex/src/app-server/run-attempt-context.ts`
- `extensions/codex/src/app-server/run-attempt-turn-request.ts`
- `extensions/codex/src/app-server/run-attempt-turn-start.ts`
- `extensions/codex/src/app-server/run-attempt.auth-context.test.ts`
- `src/agents/cli-runner.ts`
- `src/agents/command/attempt-execution.cli.test.ts`
- `src/agents/command/attempt-execution.ts`
- `src/agents/embedded-agent-runner/run.owner-hook-context.integration.test.ts`
- `src/agents/embedded-agent-runner/run/attempt-before-agent-run.test.ts`
- `src/agents/embedded-agent-runner/run/attempt-before-agent-run.ts`
- `src/agents/embedded-agent-runner/run/run-attempt-dispatch.ts`
- `src/agents/embedded-agent-runner/run/types.ts`
- `src/agents/harness/hook-context.ts`
- `src/agents/harness/lifecycle-hook-helpers.test.ts`
- `src/plugin-sdk/agent-harness-runtime.test.ts`
- `src/plugin-sdk/agent-harness-runtime.ts`
- `src/plugins/hook-agent-context.test.ts`
- `src/plugins/hook-agent-context.ts`
- `src/plugins/hook-types.ts`

## Injected bridge test files

- `src/agents/embedded-agent-runner/run.router-owner.integration.test.ts` (new)
- `extensions/codex/src/app-server/run-attempt.router-owner.test.ts` (new)
