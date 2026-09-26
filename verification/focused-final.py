"""Focused-only reconciliation. No build, package, or deployment capability."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path.cwd()
out = root / 'owner-receipts'
receipt = json.loads((out / 'receipt.json').read_text())
assert receipt['workflow_commit'] == os.environ['GITHUB_SHA']
assert receipt['run_id'] == os.environ['GITHUB_RUN_ID']
assert receipt['run_attempt'] == os.environ['GITHUB_RUN_ATTEMPT']
assert set(receipt['stages']) == {'prepare', 'router', 'scope'}
assert all(s['status'] == 'passed' for s in receipt['stages'].values())
assert all(c['exit'] == 0 and not c.get('validation_error') for c in receipt['commands'])
required = {'affected-scope-audit', 'changed-format', 'changed-format-router',
            'affected-lint-core', 'affected-lint-extensions', 'affected-lint-router', 'router-suite'}
assert required <= {c['name'] for c in receipt['commands']}
router = next(c for c in receipt['commands'] if c['name'] == 'router-suite')['test_totals']
assert router['tests'] == router['pass'] and router['tests'] > 0
assert router['fail'] == router['cancelled'] == router['skipped'] == 0
subprocess.run(['python3', 'scripts/export-owner-provenance.py'], check=True)
assert json.loads((out / 'complete-source-hashes.json').read_text())['applied_diff_sha256'] == receipt['integrity']['applied_diff_sha256']
for name, wanted in json.loads((out / 'all-source-sha256.json').read_text()).items():
    assert hashlib.sha256((root / 'source' / name).read_bytes()).hexdigest() == wanted, name
for name, wanted in json.loads((root / 'router/patched-file-hashes.json').read_text()).items():
    assert hashlib.sha256((root / 'router' / name).read_bytes()).hexdigest() == wanted, name
assert subprocess.check_output(['git', 'diff', 'HEAD', '--', 'patches', 'router', 'tests']) == b''
receipt['conclusion'] = 'FOCUSED_PASS_FULL_VERIFICATION_NOT_RUN'
receipt['production'] = 'NOT DEPLOYED'
(out / 'focused-final.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(receipt['conclusion'])
