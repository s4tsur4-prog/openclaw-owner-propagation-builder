# Isolated OpenClaw baseline builder

Official source: https://github.com/openclaw/openclaw.git
Exact commit: `3a9d69db306cd7f081e06254cb89c4bcc14a7107`
Tag: `v2026.9.4`

Runs only on a public GitHub-hosted standard ubuntu-latest x64 runner.
Node 24.21.0 satisfies the source engine range; pnpm 12.3.4 matches packageManager.
Canonical README documents install then build; package-manager lifecycle preparation
runs normally. No separate pre-build preparation, source patches, build overrides,
cache restore, runner cleanup, production secrets, or deployment are introduced.

Commands: `pnpm install --frozen-lockfile`, then `pnpm build` only on install success.
Failures stop the baseline. Disk exhaustion requires a separate Linux x64 VM
with 16 GB RAM and at least 30 GB disk; do not clean the runner to force success.
Stop after baseline results for owner review. No patch stage is included.

Artifacts contain only fresh isolated-runner logs, resource measurements, source
identity, workflow/run identity, exit codes, durations and checksums.
One-second RAM measurements are sampled whole-host usage, not exact process peaks;
GNU time records per-command maximum RSS separately. Cancelled/timed-out runs with
missing command exit codes remain UNKNOWN, never PASS. No built release artifact
or production data is uploaded.

Workflow uses read-only contents permission, credential-free checkouts, no
pull_request_target, no production secrets, and official version-pinned actions.
