#!/usr/bin/env python3
"""Run unchanged baseline commands with sampled host resource receipts."""
import json, os, pathlib, platform, shutil, subprocess, sys, time
ROOT = pathlib.Path(os.environ["GITHUB_WORKSPACE"])
SOURCE = ROOT / "source"
OUT = ROOT / "receipts"
OUT.mkdir(exist_ok=True)
def readcmd(*args):
    return subprocess.check_output(args, cwd=SOURCE, text=True).strip()
def sample():
    mem = {}
    for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        mem[key] = int(value.strip().split()[0]) * 1024
    disk = shutil.disk_usage(SOURCE)
    return {"time": time.time(), "ram_total_bytes": mem["MemTotal"],
            "ram_available_bytes": mem["MemAvailable"],
            "disk_free_bytes": disk.free, "disk_used_bytes": disk.used,
            "disk_total_bytes": disk.total}
def snapshot(label):
    with (OUT / (label + ".txt")).open("w") as f:
        for command in (["free", "-h"], ["df", "-h"], ["uname", "-a"], ["lscpu"]):
            subprocess.run(command, stdout=f, stderr=subprocess.STDOUT, check=True)
    return sample()
receipt = {"source_commit": readcmd("git", "rev-parse", "HEAD"),
           "source_tag": readcmd("git", "rev-parse", "v2026.9.4^{commit}"),
           "source_remote": readcmd("git", "remote", "get-url", "origin"),
           "workflow_commit": os.environ["GITHUB_SHA"],
           "run_id": os.environ["GITHUB_RUN_ID"],
           "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
           "run_url": os.environ["GITHUB_SERVER_URL"] + "/" + os.environ["GITHUB_REPOSITORY"] + "/actions/runs/" + os.environ["GITHUB_RUN_ID"],
           "node": readcmd("node", "--version"), "pnpm": readcmd("pnpm", "--version"),
           "os": platform.platform(), "cpu_count": os.cpu_count(),
           "sampling_seconds": 1, "install_exit": None, "build_exit": None,
           "conclusion": "NOT_STARTED"}
started = time.time()
def save():
    receipt["duration_seconds"] = round(time.time() - started, 2)
    (OUT / "baseline.json").write_text(json.dumps(receipt, indent=2) + "\n")
def runphase(name, command):
    receipt[name + "_before"] = snapshot(name + "-before")
    save()
    samples = []
    with (OUT / (name + ".log")).open("w") as log:
        process = subprocess.Popen(["/usr/bin/time", "-v", "-o", str(OUT / (name + "-time.txt")), *command],
                                   cwd=SOURCE, stdout=log, stderr=subprocess.STDOUT)
        while True:
            samples.append(sample())
            if process.poll() is not None:
                break
            time.sleep(1)
        code = process.wait()
    receipt[name + "_exit"] = code
    receipt[name + "_after"] = snapshot(name + "-after")
    receipt[name + "_peak_host_used_ram_bytes_sampled"] = max(s["ram_total_bytes"] - s["ram_available_bytes"] for s in samples)
    receipt[name + "_min_free_disk_bytes_sampled"] = min(s["disk_free_bytes"] for s in samples)
    receipt[name + "_peak_used_disk_bytes_sampled"] = max(s["disk_used_bytes"] for s in samples)
    (OUT / (name + "-samples.json")).write_text(json.dumps(samples) + "\n")
    save()
    print(name, "exit", code, flush=True)
    if code:
        tail = (OUT / (name + ".log")).read_text(errors="replace")[-12000:]
        print(tail, flush=True)
        receipt["conclusion"] = ("BLOCKED — runner disk insufficient" if "no space left on device" in tail.lower() or receipt[name + "_min_free_disk_bytes_sampled"] == 0 else name.upper() + "_FAIL")
    return code
try:
    receipt["initial"] = snapshot("initial")
    assert receipt["source_commit"] == receipt["source_tag"] == "3a9d69db306cd7f081e06254cb89c4bcc14a7107"
    assert not readcmd("git", "status", "--porcelain")
    assert platform.machine() == "x86_64"
    assert receipt["initial"]["ram_available_bytes"] >= 8_000_000_000, "less than 8 GB RAM available"
    code = runphase("install", ["pnpm", "install", "--frozen-lockfile"])
    if code == 0:
        assert not readcmd("git", "diff", "--name-only"), "install modified tracked source"
        code = runphase("build", ["pnpm", "build"])
    if code == 0:
        receipt["tracked_diff_after"] = readcmd("git", "diff", "--name-only")
        receipt["conclusion"] = "PASS" if not receipt["tracked_diff_after"] else "FAIL_SOURCE_MUTATED"
        code = 0 if receipt["conclusion"] == "PASS" else 1
except Exception as error:
    receipt["conclusion"] = "BLOCKED"
    receipt["error"] = str(error)
    code = 1
finally:
    save()
    print(json.dumps(receipt, indent=2), flush=True)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("# Baseline receipt\n\n```json\n" + json.dumps(receipt, indent=2) + "\n```\n")
sys.exit(code)
