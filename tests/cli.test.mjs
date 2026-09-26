import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, symlink, realpath, writeFile, access, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { harness } from './harness.mjs';
import { saveFile, writeExclusive } from '../lib/runtime/save-file.js';
import LocalBash from '@deepseek-ai/dsh-bash-local';
import LocalPwsh from '@deepseek-ai/dsh-pwsh-local';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';

const cli = fileURLToPath(new URL('../lib/cli.js', import.meta.url));
function run(cwd, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

test('CLI version reports its own package from another cwd without converting', async () => {
  const h = await harness();
  try {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    await writeFile(path.join(h.root, 'package.json'), JSON.stringify({ version: '999.0.0' }));
    const before = await readdir(h.root);
    for (const args of [['--version'], ['-v'], ['--version', '--request']]) {
      const result = await run(h.root, args, 'invalid request');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, manifest.version + '\n');
      assert.equal(result.stderr, '');
    }
    assert.deepEqual(await readdir(h.root), before);
  } finally { await h.close(); }
});

test('standalone CLI reads stdin, writes a valid DOCX and never overwrites', async () => {
  const h = await harness();
  try {
    const first = await run(h.root, ['-', '-o', '报告.docx'], '# 项目报告');
    assert.equal(first.code, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.path, path.join(await realpath(h.root), '报告.docx'));
    const bytes = await readFile(result.path);
    const zip = await JSZip.loadAsync(bytes);
    assert.match(await zip.file('word/document.xml').async('string'), /项目报告/);
    assert.equal(bytes.length, result.sizeBytes);
    const second = await run(h.root, ['-', '-o', '报告.docx'], 'different');
    assert.equal(JSON.parse(second.stdout).fileName, '报告 (1).docx');
    assert.deepEqual(await readFile(result.path), bytes);
  } finally { await h.close(); }
});

test('CLI file mode, default output, strict and invalid requests', async () => {
  const h = await harness();
  try {
    await writeFile(path.join(h.root, 'input.md'), '# file');
    const file = await run(h.root, ['input.md']);
    assert.equal(file.code, 0, file.stderr);
    assert.equal(JSON.parse(file.stdout).path, path.join(await realpath(h.root), 'output', 'input.docx'));
    const strict = await run(h.root, ['-', '--strict'], '![missing](missing.png)');
    assert.equal(JSON.parse(strict.stderr).error.code, 'CONTENT_INCOMPLETE');
    assert.deepEqual(JSON.parse(strict.stderr).error.diagnostics.map(d => [d.code, d.line]), [['IMAGE_UNAVAILABLE', 1]]);
    assert.deepEqual(await readdir(path.join(h.root, 'output')), ['input.docx']);
    for (const request of ['{}', '{"protocol":1,"config":{},"input":{}}', 'invalid json']) {
      const invalid = await run(h.root, ['--request'], request);
      assert.equal(invalid.code, 1);
      assert.equal(invalid.stdout, '');
    }
  } finally { await h.close(); }
});

test('CLI refuses symlinked output directories', async () => {
  const h = await harness();
  try {
    await mkdir(path.join(h.root, 'other'));
    await symlink(path.join(h.root, 'other'), path.join(h.root, 'output'), 'junction');
    const result = await run(h.root, ['-'], 'x');
    assert.equal(JSON.parse(result.stderr).error.code, 'FS_SANDBOX_DENIED');
    assert.deepEqual(await readdir(path.join(h.root, 'other')), []);
  } finally { await h.close(); }
});

test('CLI resolves an explicit -o directory alias and publishes umask permissions', async () => {
  const h = await harness();
  try {
    await mkdir(path.join(h.root, 'other'));
    await symlink(path.join(h.root, 'other'), path.join(h.root, 'alias'), 'junction');
    const result = await run(h.root, ['-', '-o', path.join('alias', 'x.docx')], '# x');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const saved = JSON.parse(result.stdout).path;
    assert.equal(saved, path.join(await realpath(path.join(h.root, 'other')), 'x.docx'));
    if (process.platform !== 'win32') assert.equal((await stat(saved)).mode & 0o777, 0o666 & ~process.umask());
  } finally { await h.close(); }
});

test('CLI reports a string error code and exit 130 when interrupted', { skip: process.platform === 'win32' }, async () => {
  const h = await harness();
  try {
    const child = spawn(process.execPath, [cli, '-'], { cwd: h.root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const closed = new Promise(resolve => child.on('close', resolve));
    // stdin stays open, so the CLI is waiting for input when the signal arrives.
    await new Promise(resolve => setTimeout(resolve, 1500));
    child.kill('SIGINT');
    assert.equal(await closed, 130);
    assert.equal(JSON.parse(stderr).error.code, 'ABORTED');
  } finally { await h.close(); }
});

test('parallel CLI publication keeps unique files and cleans temporary files', async () => {
  const h = await harness();
  try {
    const dir = path.join(await realpath(h.root), 'output');
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => saveFile(dir, 'x.docx', Buffer.from(String(i)), new AbortController().signal)));
    assert.equal(new Set(results).size, 5);
    assert.deepEqual(await Promise.all(results.map(file => readFile(file, 'utf8'))), ['0', '1', '2', '3', '4']);
    assert.equal((await readdir(dir)).length, 5);
  } finally { await h.close(); }
});

test('no-hard-link fallback never removes an existing file and cleans only its own failed write', async () => {
  const h = await harness();
  try {
    const existing = path.join(h.root, 'existing.docx');
    await writeFile(existing, 'EXISTING');
    assert.equal(await writeExclusive(existing, Buffer.from('new'), new AbortController().signal), false);
    assert.equal(await readFile(existing, 'utf8'), 'EXISTING');
    const failed = path.join(h.root, 'failed.docx');
    await assert.rejects(writeExclusive(failed, Buffer.from('x'), AbortSignal.abort()), { name: 'AbortError' });
    await assert.rejects(access(failed), { code: 'ENOENT' });
    const created = path.join(h.root, 'created.docx');
    assert.equal(await writeExclusive(created, Buffer.from('ok'), new AbortController().signal), true);
    assert.equal(await readFile(created, 'utf8'), 'ok');
  } finally { await h.close(); }
});

test('real DSH executor runs the CLI and passes model text through stdin', async () => {
  const windows = process.platform === 'win32';
  const h = await harness({ delivery: 'project' });
  try {
    await h.ctx.plugin(LocalSubprocess);
    await h.ctx.plugin(windows ? LocalPwsh : LocalBash, { cwd: h.root });
    const marker = '$(touch injected) `touch injected2`';
    const result = await h.call({ source: { kind: 'markdown', text: `# 中文\n\n${marker}` } });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(result.value.path.endsWith('document.docx'));
    const zip = await JSZip.loadAsync(await readFile(result.value.path));
    assert.match(await zip.file('word/document.xml').async('string'), /touch injected/);
    await assert.rejects(readFile(path.join(h.root, 'injected')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(h.root, 'injected2')), { code: 'ENOENT' });
    const strict = await h.call({ source: { kind: 'markdown', text: '![missing](missing.png)' }, strict: true });
    assert.equal(strict.error.info.code, 'CONTENT_INCOMPLETE');
  } finally { await h.close(); }
});

test('cancel, plugin unload and shell loss stop and await a live DSH-managed CLI process', async () => {
  for (const operation of ['cancel', 'unload', 'shell-unload']) {
    const windows = process.platform === 'win32';
    const quote = value => "'" + value.replaceAll("'", windows ? "''" : "'\\''") + "'";
    const h = await harness({ delivery: 'project', cliCommand: `${windows ? '& ' : ''}${quote(process.execPath)} delayed-cli.mjs` });
    try {
      // The long-lived fixture marks readiness only after reading the request.
      // This tests the provider process lifetime, independent of conversion speed.
      await writeFile(path.join(h.root, 'delayed-cli.mjs'), `import { writeFileSync } from 'node:fs';
let text = ''; for await (const chunk of process.stdin) text += chunk;
JSON.parse(text); writeFileSync('started', String(process.pid));
setInterval(() => {}, 1000);
`);
      await h.ctx.plugin(LocalSubprocess);
      const shellFiber = h.ctx.plugin(windows ? LocalPwsh : LocalBash, { cwd: h.root, graceMs: 100 });
      await shellFiber;
      const controller = new AbortController();
      const task = h.call({ source: { kind: 'markdown', text: 'x' } }, controller.signal);
      const deadline = Date.now() + 5000;
      while (true) {
        try { await access(path.join(h.root, 'started')); break; }
        catch { if (Date.now() > deadline) throw new Error('CLI fixture did not start'); await new Promise(resolve => setTimeout(resolve, 20)); }
      }
      const pid = Number(await readFile(path.join(h.root, 'started'), 'utf8'));
      if (operation === 'cancel') controller.abort();
      else if (operation === 'shell-unload') await shellFiber.dispose();
      else await h.fiber.dispose();
      const result = await task;
      assert.equal(result.isError, true);
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      await assert.rejects(readdir(path.join(h.root, 'output')), { code: 'ENOENT' });
      if (operation !== 'cancel') assert.equal(h.ctx.tools.get('word_export'), undefined);
    } finally { await h.close(); }
  }
});
