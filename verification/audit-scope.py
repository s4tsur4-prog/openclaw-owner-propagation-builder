"""Fail-closed audit of explicit file-only lint commands. Does not run lint."""
import hashlib
import json
from pathlib import Path
import os

root = Path.cwd().parent
source = root / 'source'
out = root / 'owner-receipts'
changed = (out / 'changed-files.txt').read_text().splitlines()
assert changed and all((source / p).is_file() for p in changed)
assert all(not p.startswith('-') and '..' not in Path(p).parts for p in changed)
original = json.loads((root / 'router/original-file-hashes.json').read_text())
patched = json.loads((root / 'router/patched-file-hashes.json').read_text())
router_changed = ['../router/' + p for p, h in patched.items() if p in original and original[p] != h]
files = changed + router_changed
code = [p for p in files if Path(p).suffix in ['.ts', '.js', '.mts', '.mjs', '.tsx', '.jsx']]
assert code
# Installed package entrypoints are read and hashed before running either tool.
entrypoints = {}
for tool in ['oxlint', 'oxfmt']:
    package = source / 'node_modules' / tool / 'package.json'
    meta = json.loads(package.read_text())
    binpath = meta['bin'][tool] if isinstance(meta['bin'], dict) else meta['bin']
    entry = package.parent / binpath
    text = entry.read_text()
    assert not any(x in text for x in ['run-lint.mts', 'run-oxlint-shards.mts', 'pnpm check']), tool
    entrypoints[tool] = {'version': meta['version'], 'path': str(entry.resolve()),
                        'sha256': hashlib.sha256(entry.read_bytes()).hexdigest(),
                        'body': text}
config = json.loads((source / '.oxlintrc.json').read_text())
assert not config.get('jsPlugins') and not config.get('extends'), 'unexpected executable lint configuration'
commands = []
for i,p in enumerate(code):
    commands.append({'name': 'syntax-%02d' % i, 'argv': ['node', '--check', p]})
commands.append({'name': 'changed-format', 'argv': ['./node_modules/.bin/oxfmt', '--check', *files]})
# Canonical type-aware and unused-directive checks are retained for TS source files.
# Explicit file operands constrain lint; tsconfig may resolve dependencies for type context.
for group,config_path,targets in [
    ('core','config/tsconfig/oxlint.core.json',[p for p in code if p.startswith('src/')]),
    ('extensions','extensions/tsconfig.json',[p for p in code if p.startswith('extensions/')]),
]:
    assert (source/config_path).is_file(), config_path
    if targets:
        commands.append({'name':'affected-lint-'+group,'argv':['./node_modules/.bin/oxlint','--type-aware','--threads=1','--report-unused-disable-directives-severity','error','--tsconfig',config_path,'--',*targets]})
router_code = [p for p in code if p.startswith('../router/')]
if router_code:
    commands.append({'name':'affected-lint-router','argv':['./node_modules/.bin/oxlint','--threads=1','--report-unused-disable-directives-severity','error','--',*router_code]})
for item in commands:
    assert not any(x in ' '.join(item['argv']) for x in ['run-lint.mts','run-oxlint-shards.mts','pnpm check'])
    if item['name'].startswith('affected-lint'):
        argv=item['argv']; operands=argv[argv.index('--')+1:]
        assert operands and set(operands) <= set(code)
        assert all((source/p).is_file() for p in operands)
(out/'scope-audit.json').write_text(json.dumps({'status':'PASS','changed_files':files,
    'commands':commands,'entrypoints':entrypoints,
    'explanation':'Direct installed tool entrypoints only; no pnpm lifecycle, run-lint, shard runner, directory operand, or full repository lint. TS type context can resolve dependencies; lint targets are explicit changed files.'},indent=2)+'\n')
print(json.dumps({'audit':'PASS','files':len(files),'commands':commands}))
