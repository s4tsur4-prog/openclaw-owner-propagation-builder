# Candidate reconciliation — 2026-09-25

Authorized continuation of run 36120175811, candidate 2b103553ce0e1a4c9903e35ce16c2a6a42a258d5. Exact upstream remains 3a9d69db306cd7f081e06254cb89c4bcc14a7107. No baseline rerun. Production NOT DEPLOYED; CRM untouched.

## Evidence custody

Job 108025232083 logs saved as job.log and decoded.log. Full artifact 10858704521 downloaded as evidence.zip and extracted into evidence/. All inner SHA256SUMS verified (hash-verification.txt). Independently computed archive SHA-256 equals provider digest: 2ad4e52b5f9c8f2cac7911a2b5ed86fffe31a07173b399771b9fffcc5b481cdd. Evidence expires 30 days after upload. Builder checkout HEAD matches candidate. No candidate edits preceded this record.

## Exact stage reconciliation

| Stage | Command exit | Tests | Root outcome |
|---|---:|---|---|
| Router syntax / standalone | all 0 | 60 pass / 0 fail | PASS; five syntax commands; human reporter counts, receipt parser had empty totals |
| Targeted core hooks / SDK | 1 | partial 59 pass / 1 fail of 60 executed | Three shards ran: hook context 20/20, SDK 24/24, embedded owner 15/16. Three remaining requested files not reached; no valid aggregate report. Expected 3 model-resolution calls, observed 6 in resumed-session test. Authority assertions preceding count passed, but do not prove every call; source lifecycle audit required before fix. |
| Router core bridge (inside targeted stage) | 0 | 8/8 pass | PASS, distinct from native stage |
| Native submission / Router bridge | 143 | UNKNOWN; no test result report | Wrapper killed process group after 120000ms without output; CPU 113%, RSS 2831472KB. No security assertion result. Need audit scoped configuration/transform startup; cannot infer security pass or failure. Outer Python timeout is 2400s, not source of termination. |
| Patched source build | 0 | N/A | PASS |
| pnpm check | 1 | N/A | Preflight max-lines suppression ratchet invokes env-var ratchet; cannot resolve origin/main in tag-only checkout. Other preflight guards pass. Downstream check phases not reached; no evidence to classify unrun formatting/lint/type phases as pass or baseline errors. |
| Core test types | 1 | N/A | Four diagnostics in newly extended attempt-before-agent-run.test.ts: TS18048 line 95 twice, TS2532 lines 128/129. Missing indexed-call guards; runtime assertions do not narrow TypeScript. |
| Extension test types | 1 | N/A | Three TS7030 diagnostics in new run-attempt.router-owner.test.ts callbacks, lines 117/164/178; falling-through branches omit explicit return. |
| Ingress / Telegram | 0 | 332/332 pass | Shards 15 + 314 + 3; 314 is not full stage count |
| Wider lifecycle | 0 | 805/805 pass | Shards 15 + 24 + 724 + 42 |
| Plugin contracts | 0 | 1117/1117 pass | PASS |
| Channel contracts | 0 | 476/476 pass | Shards 203 + 45 + 196 + 32 |
| Summary | 1 | N/A | Five required stages failed/incomplete; patched hashes verified |
| Verified packaging | NOT RUN | N/A | SKIPPED by summary gate |

## Next steps / constraints

Audit exact base lifecycle and test harness before correcting call-content/order assertions. Materialize existing candidate only, not a replacement patch. Explicitly guard mock tuples and return undefined from native interceptor fallthrough. Repair missing comparison-ref environment without changing comparison base. Diagnose native test configuration without weakening submission/security assertions. First iteration: targeted, native, core types, extension types, check only; full workflow only after these pass. Packaging remains gated on every required stage.

## Source audit before fixes

Exact-base run.overflow-compaction.harness.ts: resetSharedRunIntegrationHarnessMocks resets hasHooks and runBeforeAgentReply, but does NOT reset runBeforeModelResolve. Three preceding parameterized owner/non-owner/undefined tests therefore leave three recorded calls; resumed test adds three, producing six. This is test contamination, not evidence of duplicate core hook execution. Fix must reset the specific mock at beforeEach and validate full ordered event/context tuples and dispatched authority per run.

Exact-base check-env-var-count.mts defaults to origin/main and requires a resolvable merge-base. The isolated tag-only checkout lacks it. Set the local comparison ref to the verified exact base, record it explicitly; do not fetch moving upstream main or skip ratchets.

Native config reproduces generic scoped defaults but bypasses canonical pnpm test routing. Original evidence establishes watchdog termination, not the underlying stall cause. First focused native retest should use canonical routing and verbose reporting, retaining all seven requested files and structured file-coverage validation. Any further timeout must remain a red gate; no security assertion weakened.

Native root cause now established from exact source scripts/lib/vitest-process-env.mts: canonical test/vitest/vitest.extension-codex.config.ts has a documented 2400000ms no-output window for expensive Codex transform/import/tests. The custom owner-native config is unrecognized and receives 120000ms. Restore canonical pnpm routing; this restores upstream watchdog semantics, not an assertion bypass. Keep Python command timeout 2400s.
