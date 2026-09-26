"""Tooling tests; set OWNER_EXACT_OXLINT_CONFIG to the exact upstream config."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('audit-scope.py').resolve()
SPEC = importlib.util.spec_from_file_location('audit_scope', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class JsoncTests(unittest.TestCase):
    def test_exact_upstream_config(self):
        data = Path(os.environ.get('OWNER_EXACT_OXLINT_CONFIG', 'source/.oxlintrc.json')).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), '8bcc5a2e0f91d0dcd53ba9c38b6df90e6c9ef8e76773fa43d98d62507bee045c')
        self.assertIn(b'// Intentional negative-test corpora', data)
        self.assertIsInstance(MODULE.parse_jsonc(data.decode()), dict)

    def test_comments_trailing_commas_string_fidelity(self):
        strings = ['https://host/a//b', '/*literal*/', 'quote" backslash\\', ',}', ',]', '//', '日本語']
        value = '{/* header */"strings":' + json.dumps(strings)[:-1] + ',],// end\n}'
        self.assertEqual(MODULE.parse_jsonc(value), {'strings': strings})
        self.assertEqual(MODULE.parse_jsonc('{"a": {/*nested*/ "b": 1,},}'), {'a': {'b': 1}})

    def test_malformed_fails_closed(self):
        for value in ['{/*', '{"a":"unterminated}', '{"a":1,,}', '{,}', '{"a":[,]}',
                      '{"a":1/*gap*/2}', '{"a":tru/*gap*/e}', '{"a":1}garbage',
                      '{"a":NaN}', '{"a":Infinity}', '{"a":1,"a":2}', '[]', '{"a":}', '{"a":[1,}']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                MODULE.parse_jsonc(value)

class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        for path in ['source/src/changed.ts', 'source/src/unchanged.ts', 'source/extensions/changed.ts', 'router/changed.mjs']:
            self.put(path, 'export const value = 1;')
        self.put('router/original-file-hashes.json', '{"changed.mjs":"before"}')
        self.put('router/patched-file-hashes.json', '{"changed.mjs":"after"}')
        self.put('owner-receipts/changed-files.txt', 'src/changed.ts\nextensions/changed.ts\n')
        self.put('source/.oxlintrc.json', '{// comment\n "rules": {},}')
        for path in ['config/tsconfig/oxlint.core.json', 'extensions/tsconfig.json']:
            self.put('source/' + path, '{}')
        for tool in ['oxlint', 'oxfmt']:
            self.put(f'source/node_modules/{tool}/package.json', json.dumps({'version': 'test-fixture', 'bin': {tool: 'bin.js'}}))
            self.put(f'source/node_modules/{tool}/bin.js', '// inert test entrypoint')

    def put(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_audit(self):
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=self.source, capture_output=True, text=True)

    def test_only_changed_explicit_operands(self):
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.root / 'owner-receipts/scope-audit.json').read_text())
        expected = {'src/changed.ts', 'extensions/changed.ts', '../router/changed.mjs'}
        self.assertEqual(set(receipt['changed_files']), expected)
        targets = set()
        for command in receipt['commands']:
            if command['name'].startswith('affected-lint'):
                argv = command['argv']
                operands = argv[argv.index('--') + 1:]
                self.assertTrue(operands)
                self.assertLessEqual(set(operands), expected)
                targets.update(operands)
        self.assertEqual(targets, expected)

    def test_forbidden_full_lint_wrappers_rejected(self):
        for command in ['node scripts/run-lint.mts', 'node scripts/run-oxlint-shards.mts', 'pnpm check']:
            with self.subTest(command=command):
                self.put('source/node_modules/oxlint/bin.js', command)
                self.assertNotEqual(self.run_audit().returncode, 0)

    def test_uncontrolled_config_rejected(self):
        for config in [{'jsPlugins': ['evil']}, {'extends': ['elsewhere']}, {'overrides': [{'jsPlugins': ['evil']}]}, {'overrides': [{'extends': ['elsewhere']}]}]:
            with self.subTest(config=config):
                self.put('source/.oxlintrc.json', json.dumps(config))
                self.assertNotEqual(self.run_audit().returncode, 0)

    def test_directory_escape_option_operands_rejected(self):
        for operand in ['.', 'src/', '../router/changed.mjs', str(self.source / 'src/changed.ts'), '--help']:
            with self.subTest(operand=operand):
                self.put('owner-receipts/changed-files.txt', operand + '\n')
                self.assertNotEqual(self.run_audit().returncode, 0)

    def test_malformed_config_writes_no_pass_receipt(self):
        self.put('source/.oxlintrc.json', '{"rules": /* unterminated')
        self.assertNotEqual(self.run_audit().returncode, 0)
        self.assertFalse((self.root / 'owner-receipts/scope-audit.json').exists())

if __name__ == '__main__':
    unittest.main()
