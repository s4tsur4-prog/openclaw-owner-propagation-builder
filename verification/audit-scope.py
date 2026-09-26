"""Fail-closed audit of explicit file-only lint commands. Does not run lint."""
import hashlib
import json
from pathlib import Path


def parse_jsonc(text):
    """Lex JSONC without touching strings; strict JSON validates the token stream.

    Only comments and trailing commas extend JSON. Comments become whitespace
    (never join tokens). Duplicate keys and non-finite numbers fail closed.
    """
    tokens = []
    i = 0
    decoder = json.JSONDecoder()
    while i < len(text):
        char = text[i]
        if char == '"':
            _, end = decoder.raw_decode(text, i)
            tokens.append(text[i:end])
            i = end
        elif text.startswith('//', i):
            end = text.find('\n', i + 2)
            i = len(text) if end == -1 else end
            tokens.append(' ')
        elif text.startswith('/*', i):
            end = text.find('*/', i + 2)
            if end == -1:
                raise ValueError('unterminated JSONC block comment')
            tokens.append(' ')
            i = end + 2
        else:
            tokens.append(char)
            i += 1
    # Only a comma following a value may be removed before a closing delimiter.
    # In particular [,], {,}, and repeated commas must stay malformed.
    significant = [i for i, token in enumerate(tokens) if token.strip()]
    for pos, index in enumerate(significant):
        if tokens[index] != ',' or pos == 0 or pos + 1 == len(significant):
            continue
        previous = tokens[significant[pos - 1]]
        following = tokens[significant[pos + 1]]
        if following in (']', '}') and previous not in ('[', '{', ',', ':'):
            tokens[index] = ' '

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSONC object key: ' + key)
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError('non-JSON constant: ' + value)

    result = json.loads(''.join(tokens), object_pairs_hook=unique_object,
                        parse_constant=reject_constant)
    if not isinstance(result, dict):
        raise ValueError('lint configuration must be an object')
    return result


def audit():
    root = Path.cwd().parent
    source = root / 'source'
    out = root / 'owner-receipts'
    changed = (out / 'changed-files.txt').read_text().splitlines()
    assert changed and all((source / p).is_file() for p in changed)
    assert all(not p.startswith('-') and not Path(p).is_absolute() and '..' not in Path(p).parts
               and (source / p).resolve().is_relative_to(source.resolve()) for p in changed)
    original = json.loads((root / 'router/original-file-hashes.json').read_text())
    patched = json.loads((root / 'router/patched-file-hashes.json').read_text())
    router = root / 'router'
    def validate_operands(base, operands):
        assert operands
        for operand in operands:
            path = Path(operand)
            assert operand and not operand.startswith('-') and not path.is_absolute()
            assert '..' not in path.parts and (base / path).is_file()
            assert (base / path).resolve().is_relative_to(base.resolve())
    validate_operands(router, list(patched))
    router_changed = [p for p, h in patched.items() if p in original and original[p] != h]
    files = changed + ['router/' + p for p in router_changed]
    suffixes = ['.ts', '.js', '.mts', '.mjs', '.tsx', '.jsx']
    code = [p for p in changed if Path(p).suffix in suffixes]
    router_code = [p for p in router_changed if Path(p).suffix in suffixes]
    assert code or router_code
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
    config = parse_jsonc((source / '.oxlintrc.json').read_text())
    def check_config(value):
        if isinstance(value, dict):
            assert not value.get('jsPlugins') and not value.get('extends'), 'unexpected executable lint configuration'
            for child in value.values():
                check_config(child)
        elif isinstance(value, list):
            for child in value:
                check_config(child)
    check_config(config)
    commands = []
    for i,p in enumerate(code):
        commands.append({'name': 'syntax-%02d' % i, 'cwd': 'source', 'argv': ['node', '--check', p]})
    commands.append({'name': 'changed-format', 'cwd': 'source', 'argv': [entrypoints['oxfmt']['path'], '--check', '--', *changed]})
    if router_changed:
        commands.append({'name': 'changed-format-router', 'cwd': 'router', 'argv': [entrypoints['oxfmt']['path'], '--config', str(source / '.oxfmtrc.jsonc'), '--check', '--', *router_changed]})
    for i, p in enumerate(router_code):
        commands.append({'name': 'syntax-router-%02d' % i, 'cwd': 'router', 'argv': ['node', '--check', p]})
    # Canonical type-aware and unused-directive checks are retained for TS source files.
    # Explicit file operands constrain lint; tsconfig may resolve dependencies for type context.
    for group,config_path,targets in [
        ('core','config/tsconfig/oxlint.core.json',[p for p in code if p.startswith('src/')]),
        ('extensions','extensions/tsconfig.json',[p for p in code if p.startswith('extensions/')]),
    ]:
        assert (source/config_path).is_file(), config_path
        if targets:
            commands.append({'name':'affected-lint-'+group,'cwd':'source','argv':['./node_modules/.bin/oxlint','--type-aware','--threads=1','--report-unused-disable-directives-severity','error','--tsconfig',config_path,'--',*targets]})
    if router_code:
        commands.append({'name':'affected-lint-router','cwd':'router','argv':[entrypoints['oxlint']['path'],'--config',str(source / '.oxlintrc.json'),'--threads=1','--report-unused-disable-directives-severity','error','--',*router_code]})
    for item in commands:
        assert not any(x in ' '.join(item['argv']) for x in ['run-lint.mts','run-oxlint-shards.mts','pnpm check'])
        if item['name'].startswith(('affected-lint', 'changed-format')):
            argv=item['argv']; operands=argv[argv.index('--')+1:]
            assert item['cwd'] in ('source', 'router')
            allowed = router_changed if item['cwd'] == 'router' else changed
            assert operands and set(operands) <= set(allowed)
            validate_operands(root / item['cwd'], operands)
    (out/'scope-audit.json').write_text(json.dumps({'status':'PASS','changed_files':files,
        'commands':commands,'entrypoints':entrypoints,
        'explanation':'Direct installed tool entrypoints only; no pnpm lifecycle, run-lint, shard runner, directory operand, or full repository lint. TS type context can resolve dependencies; lint targets are explicit changed files.'},indent=2)+'\n')
    print(json.dumps({'audit':'PASS','files':len(files),'commands':commands}))


if __name__ == "__main__":
    audit()
