# Acceptance evidence map

This maps real execution paths to candidate tests, not to claimed results. Read the final successful full-run receipt before interpreting any item as PASS. Production NOT DEPLOYED.

| Requirement | Producer / consumer | Focused evidence |
|---|---|---|
| Owner before model resolution | Existing inbound resolver -> run params -> orchestrator hookCtx -> resolveHookModelSelection | run.owner-hook-context.integration.test.ts, true/false/undefined cases |
| Owner before agent run / event parity | Current-run projector -> embedded before-agent gate, CLI lifecycle, native pre-submission gate | attempt-before-agent-run.test.ts; attempt-execution.cli.test.ts; run-attempt.auth-context.test.ts |
| No owner leakage across resumed same-session runs | Per-run params, no owner cache | Ordered owner/non-owner/undefined call tuples and hook-before-attempt order in run.owner-hook-context.integration.test.ts |
| Cron, heartbeat, recovery, subagent, internal | Current-run projector rejects trigger/provenance/run-kind/lineage | hook-agent-context.test.ts; lifecycle-hook-helpers.test.ts; owner-hook integration; native auth-context |
| Channel/account isolation | Existing resolver and current-run context, no re-derived owner allowlist | owner-hook integration account/channel cases; affected ingress suite; Router owner identity tests |
| Normal Sol / owner HIGH Astra | Orchestrator selection and Router; native actual turn/start | run.router-owner.integration.test.ts; run-attempt.router-owner.test.ts |
| Actual selected/effective equality, no silent fallback | Native startup model tuple -> before_agent_run -> llm_input receipt | Native Router bridge startup/request mismatch cases, Router lifecycle tests |
| False/undefined or stale owner fail-closed | Real pre-reply and native pre-submission policy gates | Core bridge same-session stored binding denial; native Router false/undefined after selection; native scheduled/recovery/child tests |
| Native retry safety | Gate rechecked before each turn/start | Native auth-context compact retry block/pass cases, exactly one model diagnostic start |
| True senior unavailability stops | Model-error classification -> Router durable stop | failure-classification.test.js and plugin-lifecycle.test.js |
| Abort/tool/delivery/finalization not false unavailability | Failure-kind/category classification | failure-classification.test.js and plugin-lifecycle.test.js |
| Binding only from authoritative true | recordTrustedOwner; persistent store audit only | owner-decision.test.js, failure-classification.test.js, plugin-lifecycle.test.js |
| Backward-compatible sparse field | Optional hook context field, legacy runner methods | SDK and lifecycle-hook-helpers.test.ts |

Native RPC transport is synthetic. Model entitlement, real Telegram acceptance and live persistence remain deployment acceptance work, not CI claims. The Router store never grants authority when current ctx.senderIsOwner is false/undefined.
