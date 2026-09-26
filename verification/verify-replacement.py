"""Isolated exact-source verification; never reads production state."""
import hashlib
import json
import os
import re
import traceback
import signal
import threading
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

def now():
    return datetime.now(timezone.utc).isoformat()

ROOT = Path.cwd()
SOURCE = ROOT / "source"
OUT = ROOT / "owner-receipts"
OUT.mkdir(exist_ok=True)
BASE = "3a9d69db306cd7f081e06254cb89c4bcc14a7107"
CANDIDATE = "88a818f49858753eecb02a28623c4d8fb574a939"
DISCLOSURE = "Full upstream oxlint suite was not completed due to excessive resource requirements. Candidate verification used targeted functional, security, type, build, integration, and affected-scope lint gates."
initial_receipt = {
    "candidate_commit": CANDIDATE,
    "disclosure": DISCLOSURE,
    "full_upstream_pnpm_check": "NOT_COMPLETED_NOT_PASS",
    "full_upstream_oxlint": "NOT_COMPLETED_NOT_PASS",
    "policy": "replacement-gates-standard-runner-authorized-2026-09-26",
    "base_commit": BASE,
    "release": "v2026.9.4",
    "workflow_commit": os.environ["GITHUB_SHA"],
    "run_id": os.environ["GITHUB_RUN_ID"],
    "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
    "production": "NOT DEPLOYED",
    "commands": [],
    "readiness": "DRAFT_CI_RESULTS_PENDING",
}

STAGES = ["prepare", "router", "targeted", "native", "build", "scope", "core-types", "extension-types", "ingress", "wider", "contracts"]
STAGE = sys.argv[1] if len(sys.argv) == 2 else "summary"
assert STAGE in [*STAGES, "summary", "package"], STAGE
receipt_path = OUT / "receipt.json"
receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else initial_receipt
assert receipt["workflow_commit"] == os.environ["GITHUB_SHA"]
assert receipt["run_id"] == os.environ["GITHUB_RUN_ID"]
assert receipt["run_attempt"] == os.environ["GITHUB_RUN_ATTEMPT"]
receipt.setdefault("stages", {})

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def save():
    (OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")

def terminal_exception(kind, error, tb):
    receipt["conclusion"] = "BLOCKED_RECEIPT_OR_SOURCE_VERIFICATION"
    receipt["error"] = str(error)
    receipt["stages"][STAGE] = {"status": "failed", "error": str(error)}
    save()
    print("TERMINAL_RECEIPT " + json.dumps(receipt), flush=True)
    traceback.print_exception(kind, error, tb)

sys.excepthook = terminal_exception

def run(name, args, cwd=SOURCE, timeout=3600):
    assert not any(x in " ".join(args) for x in ["run-lint.mts", "run-oxlint-shards.mts", "pnpm check"])
    started = time.monotonic()
    timestamp = now()
    env = os.environ.copy()
    env["OPENCLAW_ROUTER_TEST_DIR"] = str(ROOT / "router")
    print("COMMAND_START " + json.dumps({"name": name, "argv": args, "stage": STAGE}), flush=True)
    log_path = OUT / (name + ".log")
    with log_path.open("w") as log:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        with (OUT / (name + "-resources.log")).open("w") as resource_log:
            sampler = subprocess.Popen(["python3", str(ROOT / "replacement-tools/verification/sample-resources.py"),
                                        str(process.pid), str(OUT / (name + "-resources.jsonl"))],
                                       cwd=cwd, stdout=resource_log, stderr=subprocess.STDOUT)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                code = 124
            finally:
                sampler.terminate()
                sampler.wait(timeout=10)
    entry = {"name": name, "argv": args, "cwd": str(cwd.relative_to(ROOT)),
             "stage": STAGE, "exit": code, "started_at": timestamp, "finished_at": now(),
             "candidate_commit": CANDIDATE, "upstream_commit": BASE,
             "output_sha256": digest(log_path), "seconds": round(time.monotonic() - started, 3)}
    if name == "router-suite":
        tap = log_path.read_text(errors="replace")
        entry["test_totals"] = {key: int(value) for key, value in
                                re.findall(r"^# (tests|pass|fail|cancelled|skipped) (\d+)$", tap, re.M)}
    receipt["commands"].append(entry)
    save()
    print(json.dumps(entry), flush=True)
    print(log_path.read_text(errors="replace")[-18000:], flush=True)
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

def tests(name, paths, native=False):
    output = OUT / (name + ".json")
    # Canonical routing carries the upstream Codex-specific startup watchdog.
    # Custom configs silently lose it and are killed after 120s of transform.
    args = ["pnpm", "test", *paths]
    code = run(name, [*args, "--reporter=default", "--reporter=json", "--outputFile", str(output)])
    data = json.loads(output.read_text()) if output.exists() else {}
    totals = {k: data.get(k) for k in ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "success"]}
    receipt.setdefault("test_totals", {})[name] = totals
    receipt["commands"][-1]["test_totals"] = totals
    if output.exists():
        receipt["commands"][-1]["test_output_sha256"] = digest(output)
    if code == 0 and (not data.get("success") or not data.get("numTotalTests")):
        receipt["commands"][-1]["validation_error"] = "missing, empty, or unsuccessful structured test receipt"
    if code == 0:
        reported = [str(item.get("name", "")) for item in data.get("testResults", [])]
        missing = [path for path in paths if path.endswith(".test.ts") and not any(name.endswith(path) for name in reported)]
        if missing:
            receipt["commands"][-1]["validation_error"] = {"unreported_requested_test_files": missing}
    save()
    return code


def prepare():
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE, text=True).strip() == BASE
    assert subprocess.check_output(["git", "status", "--porcelain"], cwd=SOURCE) == b""
    assert_hashes("original")
    receipt["node"] = subprocess.check_output(["node", "--version"], text=True).strip()
    receipt["pnpm"] = subprocess.check_output(["pnpm", "--version"], text=True).strip()
    assert receipt["node"] == "v24.21.0"
    assert receipt["pnpm"] == "12.3.4"
    assert run("patch-check", ["git", "apply", "--check", str(ROOT / "patches/owner-context.patch")]) == 0
    assert run("patch-apply", ["git", "apply", str(ROOT / "patches/owner-context.patch")]) == 0
    assert_hashes("patched")
    for relative, wanted in json.loads((ROOT / "router/patched-file-hashes.json").read_text()).items():
        assert digest(ROOT / "router" / relative) == wanted, relative
    for line in (ROOT / "tests/SHA256SUMS").read_text().splitlines():
        wanted, relative = line.split(None, 1)
        assert digest(ROOT / "tests" / relative.strip()) == wanted, relative
    bridges = {
        "run.router-owner.integration.test.ts": "src/agents/embedded-agent-runner",
        "run-attempt.router-owner.test.ts": "extensions/codex/src/app-server",
    }
    for filename, target in bridges.items():
        shutil.copyfile(ROOT / "tests" / filename, SOURCE / target / filename)
    assert run("diff-whitespace", ["git", "diff", "--check"]) == 0
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == CANDIDATE
    integrity("pre-install")
    assert run("frozen-install", ["pnpm", "install", "--frozen-lockfile"]) == 0
    integrity("post-install")


def integrity(label):
    assert run("integrity-" + label, ["python3", "scripts/export-owner-provenance.py"], cwd=ROOT) == 0
    data = json.loads((OUT / "complete-source-hashes.json").read_text())
    assert data["applied_diff_sha256"] == "eb3c96bd85c1c5b682693ae5e3b6144d09b95c09b89bbaf481f3382d38399c6a"
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=SOURCE).decode().split("\0")
    hashes = {p: digest(SOURCE / p) for p in sorted(set(filter(None, tracked))) if (SOURCE / p).is_file()}
    target = OUT / "all-source-sha256.json"
    if target.exists():
        assert json.loads(target.read_text()) == hashes, "full source bytes changed"
    else:
        target.write_text(json.dumps(hashes, indent=2) + "\n")
    assert subprocess.check_output(["git", "diff", "HEAD", "--", "patches", "router", "tests"], cwd=ROOT) == b""
    receipt["integrity"] = {"status": "PASS", "at": now(), "label": label,
                            "tracked_source_files": len(hashes), "manifest_sha256": digest(target),
                            "applied_diff_sha256": data["applied_diff_sha256"]}
    save()


def contracts(name, script):
    output = OUT / (name + ".json")
    code = run(name, ["pnpm", script, "--reporter=default", "--reporter=json", "--outputFile", str(output)])
    data = json.loads(output.read_text()) if output.exists() else {}
    receipt["commands"][-1]["test_totals"] = {k: data.get(k) for k in ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "success"]}
    if code == 0 and (not data.get("success") or not data.get("numTotalTests")):
        receipt["commands"][-1]["validation_error"] = "missing contract structured test results"
    if output.exists():
        receipt["commands"][-1]["test_output_sha256"] = digest(output)
    save()


def execute_stage():
    if STAGE == "prepare":
        prepare()
    elif STAGE == "router":
        for p in sorted((ROOT / "router").glob("*.js")):
            run("router-syntax-" + p.stem, ["node", "--check", str(p)])
        run("router-suite", ["node", "--test", *[str(p) for p in sorted((ROOT / "router/test").glob("*.test.js"))]])
    elif STAGE == "targeted":
        tests("targeted-core", [
            "src/plugins/hook-agent-context.test.ts",
            "src/agents/harness/lifecycle-hook-helpers.test.ts",
            "src/agents/command/attempt-execution.cli.test.ts",
            "src/agents/embedded-agent-runner/run/attempt-before-agent-run.test.ts",
            "src/agents/embedded-agent-runner/run.owner-hook-context.integration.test.ts",
            "src/plugin-sdk/agent-harness-runtime.test.ts",
        ])
        tests("router-core-bridge", ["src/agents/embedded-agent-runner/run.router-owner.integration.test.ts"])
    elif STAGE == "native":
        tests("native-router-and-gates", [
            "extensions/codex/src/app-server/run-attempt.auth-context.test.ts",
            "extensions/codex/src/app-server/run-attempt.router-owner.test.ts",
            "extensions/codex/src/app-server/run-attempt-runtime.authority.test.ts",
            "extensions/codex/src/app-server/run-attempt.hooks.test.ts",
            "extensions/codex/src/app-server/run-attempt.steering-authority.test.ts",
            "extensions/codex/src/app-server/run-attempt.turn-watches.test.ts",
            "extensions/codex/src/app-server/run-attempt-lifecycle-controller.test.ts",
        ], native=True)
    elif STAGE == "build":
        run("build", ["pnpm", "build"])
    elif STAGE == "scope":
        assert run("affected-scope-audit", ["python3", str(ROOT / "replacement-tools/verification/audit-scope.py")]) == 0
        scope = json.loads((OUT / "scope-audit.json").read_text())
        for item in scope["commands"]:
            run(item["name"], item["argv"])
    elif STAGE == "core-types":
        run("core-production-types", ["pnpm", "tsgo:core"])
        run("core-test-types", ["pnpm", "tsgo:core:test"])
    elif STAGE == "extension-types":
        run("extension-production-types", ["pnpm", "tsgo:extensions"])
        run("extension-test-types", ["pnpm", "tsgo:extensions:test"])
    elif STAGE == "ingress":
        tests("affected-ingress", [
            "src/auto-reply/command-auth.owner-default.test.ts",
            "src/auto-reply/reply/get-reply-run.media-only.test.ts",
            "src/auto-reply/reply/queue.collect.test.ts",
            "src/auto-reply/reply/dispatch-from-config.owner-metadata.test.ts",
            "src/auto-reply/reply/reply-turn-admission.heartbeat-recovery.test.ts",
            "src/auto-reply/reply/agent-runner-steer-adoption.question-recovery.test.ts",
            "extensions/telegram/src/conversation-route-owner.test.ts",
        ])
    elif STAGE == "wider":
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
    elif STAGE == "package":
        assert receipt.get("conclusion") == "CHECKS_PASS_REVIEW_REQUIRED"
        assert all(receipt["stages"].get(stage, {}).get("status") == "passed" for stage in STAGES)
        code = run("package", ["node", "scripts/package-openclaw-for-docker.mjs",
                   "--bundle-plugin", "codex", "--output-dir", "../owner-receipts/package",
                   "--output-name", "openclaw-2026.9.4-owner-propagation.tgz",
                   "--pack-json", "../owner-receipts/package/pack.json"])
        if code == 0:
            archive = OUT / "package/openclaw-2026.9.4-owner-propagation.tgz"
            import tarfile
            with tarfile.open(archive) as packed:
                names = packed.getnames()
            assert any(name.startswith("package/dist/extensions/codex/") for name in names), "Codex adapter missing from package"
            assert any(name.startswith("package/node_modules/@openclaw/ai/") for name in names), "workspace AI runtime missing"
            receipt["package"] = {"path": "package/" + archive.name, "sha256": digest(archive), "bytes": archive.stat().st_size,
                                  "bundled_plugin": "codex", "offline_install": False}
            assert_hashes("patched")
            integrity("post-package")
            receipt["readiness"] = "CI_AND_PACKAGE_PASS_PENDING_ARTIFACT_REVIEW"
            save()
            (OUT / "package/provenance.json").write_text(json.dumps(receipt, indent=2) + "\n")
    elif STAGE == "contracts":
        contracts("plugin-contracts", "test:contracts:plugins")
        contracts("channel-contracts", "test:contracts:channels")


save()
if STAGE == "summary":
    required = STAGES
    complete = all(receipt["stages"].get(stage, {}).get("status") == "passed" for stage in required)
    if receipt["stages"].get("prepare", {}).get("status") == "passed":
        assert_hashes("patched")
        integrity("final-summary")
    receipt["missing_or_failed_stages"] = [stage for stage in required if receipt["stages"].get(stage, {}).get("status") != "passed"]
    receipt["conclusion"] = "CHECKS_PASS_REVIEW_REQUIRED" if complete else "BLOCKED_CHECKS_FAILED_OR_INCOMPLETE"
    save()
    (OUT / "VERIFICATION-SUMMARY.md").write_text("# Replacement verification\n\n" + DISCLOSURE + "\n\nCandidate: " + CANDIDATE + "\n\nProduction: NOT DEPLOYED. STOP for final review.\n\n" + "\n".join("- " + stage + ": " + receipt["stages"].get(stage, {}).get("status", "NOT RUN") for stage in required) + "\n")
    print("FINAL_RECEIPT\n" + json.dumps(receipt, indent=2), flush=True)
    sys.exit(0 if complete else 1)
if STAGE != "prepare" and receipt["stages"].get("prepare", {}).get("status") != "passed":
    receipt["stages"][STAGE] = {"status": "blocked", "reason": "prepare did not pass"}
    save()
    sys.exit(1)
assert STAGE not in receipt["stages"], "stage already recorded; use a new workflow attempt"
receipt["stages"][STAGE] = {"status": "running"}
save()
start_index = len(receipt["commands"])
execute_stage()
entries = receipt["commands"][start_index:]
passed = bool(entries) and all(entry["exit"] == 0 and not entry.get("validation_error") for entry in entries)
receipt["stages"][STAGE] = {"status": "passed" if passed else "failed", "commands": [entry["name"] for entry in entries]}
if STAGE == "package":
    receipt["conclusion"] = "CI_AND_PACKAGE_PASS_REVIEW_REQUIRED" if passed else "BLOCKED_PACKAGE"
save()
(OUT / (STAGE + "-receipt.json")).write_text(json.dumps({
    "stage": STAGE, "candidate_commit": CANDIDATE, "upstream_commit": BASE,
    "timestamp": now(), "workflow_commit": os.environ["GITHUB_SHA"],
    "run_id": os.environ["GITHUB_RUN_ID"], "result": receipt["stages"][STAGE],
    "commands": entries, "disclosure": DISCLOSURE,
}, indent=2) + "\n")
sys.exit(0 if passed else 1)
