"""Isolated exact-source verification; never reads production state."""
import hashlib
import json
import os
import re
import traceback
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path.cwd()
SOURCE = ROOT / "source"
OUT = ROOT / "owner-receipts"
OUT.mkdir(exist_ok=True)
BASE = "3a9d69db306cd7f081e06254cb89c4bcc14a7107"
receipt = {
    "base_commit": BASE,
    "release": "v2026.9.4",
    "workflow_commit": os.environ["GITHUB_SHA"],
    "run_id": os.environ["GITHUB_RUN_ID"],
    "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
    "production": "NOT DEPLOYED",
    "commands": [],
    "readiness": "DRAFT_NATIVE_GATE_UNVERIFIED",
}

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def save():
    (OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")

def terminal_exception(kind, error, tb):
    receipt["conclusion"] = "BLOCKED_RECEIPT_OR_SOURCE_VERIFICATION"
    receipt["error"] = str(error)
    save()
    print("TERMINAL_RECEIPT " + json.dumps(receipt), flush=True)
    traceback.print_exception(kind, error, tb)

sys.excepthook = terminal_exception

def run(name, args, cwd=SOURCE, timeout=2400):
    started = time.monotonic()
    env = os.environ.copy()
    env["OPENCLAW_ROUTER_TEST_DIR"] = str(ROOT / "router")
    with (OUT / (name + ".log")).open("w") as log:
        try:
            code = subprocess.run(args, cwd=cwd, env=env, stdout=log,
                                  stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            code = 124
    entry = {"name": name, "argv": args, "cwd": str(cwd.relative_to(ROOT)),
             "exit": code, "seconds": round(time.monotonic() - started, 3)}
    if name == "router-suite":
        tap = (OUT / (name + ".log")).read_text(errors="replace")
        entry["test_totals"] = {key: int(value) for key, value in
                                re.findall(r"^# (tests|pass|fail|cancelled|skipped) (\d+)$", tap, re.M)}
    receipt["commands"].append(entry)
    save()
    print(json.dumps(entry), flush=True)
    print((OUT / (name + ".log")).read_text(errors="replace")[-18000:], flush=True)
    return code

def assert_hashes(which):
    manifest = json.loads((ROOT / "patches/source-files.json").read_text())
    assert digest(ROOT / "patches/owner-context.patch") == manifest["patch_sha256"]
    for item in manifest["files"]:
        p = SOURCE / item["path"]
        wanted = item[which + "_sha256"]
        if wanted is None:
            assert not p.exists(), item["path"]
        else:
            assert digest(p) == wanted, item["path"]
    receipt[which + "_file_hashes_verified"] = True
    save()

def tests(name, paths):
    return run(name, ["pnpm", "test", *paths, "--reporter=default", "--reporter=json",
                      "--outputFile", str(OUT / (name + ".json"))])

save()
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE, text=True).strip() == BASE
assert subprocess.check_output(["git", "status", "--porcelain"], cwd=SOURCE) == b""
assert_hashes("original")
receipt["node"] = subprocess.check_output(["node", "--version"], text=True).strip()
receipt["pnpm"] = subprocess.check_output(["pnpm", "--version"], text=True).strip()
if run("frozen-install", ["pnpm", "install", "--frozen-lockfile"]):
    receipt["conclusion"] = "BLOCKED_INSTALL"
    save()
    sys.exit(1)
assert subprocess.check_output(["git", "status", "--porcelain"], cwd=SOURCE) == b""
if run("patch-check", ["git", "apply", "--check", str(ROOT / "patches/owner-context.patch")]):
    receipt["conclusion"] = "BLOCKED_PATCH_CHECK"
    save()
    sys.exit(1)
if run("patch-apply", ["git", "apply", str(ROOT / "patches/owner-context.patch")]):
    receipt["conclusion"] = "BLOCKED_PATCH_APPLY"
    save()
    sys.exit(1)
assert_hashes("patched")
shutil.copyfile(ROOT / "tests/run.router-owner.integration.test.ts",
                SOURCE / "src/agents/embedded-agent-runner/run.router-owner.integration.test.ts")
run("diff-whitespace", ["git", "diff", "--check"])
for p in sorted((ROOT / "router").glob("*.js")):
    run("router-syntax-" + p.stem, ["node", "--check", str(p)])
run("router-suite", ["node", "--test", *[str(p) for p in sorted((ROOT / "router/test").glob("*.test.js"))]])
tests("targeted-core", [
    "src/plugins/hook-agent-context.test.ts",
    "src/agents/harness/lifecycle-hook-helpers.test.ts",
    "src/agents/command/attempt-execution.cli.test.ts",
    "src/agents/embedded-agent-runner/run/attempt-before-agent-run.test.ts",
    "src/agents/embedded-agent-runner/run.owner-hook-context.integration.test.ts",
])
tests("router-core-bridge", ["src/agents/embedded-agent-runner/run.router-owner.integration.test.ts"])
run("build", ["pnpm", "build"])
run("check", ["pnpm", "check"])
run("core-test-types", ["pnpm", "tsgo:core:test"])
tests("affected-ingress", [
    "src/auto-reply/command-auth.owner-default.test.ts",
    "src/auto-reply/reply/get-reply-run.media-only.test.ts",
    "src/auto-reply/reply/queue.collect.test.ts",
    "src/auto-reply/reply/dispatch-from-config.owner-metadata.test.ts",
    "src/auto-reply/reply/reply-turn-admission.heartbeat-recovery.test.ts",
    "src/auto-reply/reply/agent-runner-steer-adoption.question-recovery.test.ts",
    "extensions/telegram/src/conversation-route-owner.test.ts",
])
tests("wider-lifecycle", [
    "src/agents/harness",
    "src/plugins/hooks.model-override-wiring.test.ts",
    "src/plugins/hooks.before-agent-reply.test.ts",
    "src/plugins/hooks.before-agent-finalize.test.ts",
    "src/plugins/hook-lifecycle-gates.test.ts",
    "src/plugins/restart-recovery-hook-safety.test.ts",
    "src/agents/embedded-agent-runner/run/setup.test.ts",
    "src/agents/embedded-agent-runner/run.prepared-harness-source-delivery.integration.test.ts",
])
run("plugin-contracts", ["pnpm", "test:contracts:plugins"])
run("channel-contracts", ["pnpm", "test:contracts:channels"])
assert_hashes("patched")
receipt["conclusion"] = "CHECKS_PASS_REVIEW_GAPS_REMAIN" if all(c["exit"] == 0 for c in receipt["commands"]) else "BLOCKED_CHECKS_FAILED"
for p in OUT.glob("*.json"):
    if p.name == "receipt.json":
        continue
    data = json.loads(p.read_text())
    if isinstance(data, dict) and "numTotalTests" in data:
        receipt.setdefault("test_totals", {})[p.stem] = {
            k: data.get(k) for k in ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "success"]
        }
save()
print("FINAL_RECEIPT\n" + json.dumps(receipt, indent=2), flush=True)
sys.exit(0 if all(c["exit"] == 0 for c in receipt["commands"]) else 1)
