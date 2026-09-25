"""Export allowlisted candidate source evidence; no installation or service access."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path.cwd()
source = root / "source"
out = root / "owner-receipts"
out.mkdir(exist_ok=True)
manifest = json.loads((root / "patches/source-files.json").read_text())
base = manifest["base_commit"]
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == base


def sha(data):
    return hashlib.sha256(data).hexdigest()


files = [dict(item) for item in manifest["files"]]
for filename, parent in [
    ("run.router-owner.integration.test.ts", "src/agents/embedded-agent-runner"),
    ("run-attempt.router-owner.test.ts", "extensions/codex/src/app-server"),
]:
    files.append({"path": parent + "/" + filename, "original_sha256": None,
                  "patched_sha256": sha((root / "tests" / filename).read_bytes())})
assert sha((root / "patches/owner-context.patch").read_bytes()) == manifest["patch_sha256"]
for item in files:
    original = subprocess.run(["git", "show", base + ":" + item["path"]], cwd=source,
                              capture_output=True, check=False)
    if item["original_sha256"] is None:
        assert original.returncode != 0, "new file existed in base: " + item["path"]
    else:
        assert original.returncode == 0 and sha(original.stdout) == item["original_sha256"], item["path"]
    assert sha((source / item["path"]).read_bytes()) == item["patched_sha256"], item["path"]

tracked = subprocess.check_output(["git", "diff", "--name-only", "HEAD", "-z"], cwd=source).decode().split("\0")
untracked = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=source).decode().split("\0")
actual = set(filter(None, tracked + untracked))
expected = {item["path"] for item in files}
assert actual == expected, {"unexpected": sorted(actual - expected), "missing": sorted(expected - actual)}
# Include new files in the complete diff without committing or changing bytes.
subprocess.run(["git", "add", "--intent-to-add", "--", *sorted(expected)], cwd=source, check=True)
diff = subprocess.check_output(["git", "diff", "--binary", "HEAD", "--", *sorted(expected)], cwd=source)
subprocess.run(["git", "diff", "--check"], cwd=source, check=True)
(out / "applied-source.diff").write_bytes(diff)
(out / "changed-files.txt").write_text("\n".join(sorted(expected)) + "\n")
(out / "complete-source-hashes.json").write_text(json.dumps({
    "base_commit": base, "applied_diff_sha256": sha(diff), "files": files,
}, indent=2) + "\n")
print(json.dumps({"source_files": len(files), "applied_diff_sha256": sha(diff), "production": "NOT DEPLOYED"}))
