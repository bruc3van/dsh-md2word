import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { harness } from './harness.mjs';
import { outputName } from '../lib/runtime/paths.js';
import { Config, defaults, resolveConfig } from '../lib/config.js';
const source = text => ({ source: { kind: 'markdown', text } });
test('filenames reject paths, device names, controls and ambiguous trailing characters', () => {
  for (const name of ['../x', 'a/b', 'a\\b', 'CON', 'nul.docx', ' a', 'a.', 'a\0']) assert.throws(() => outputName(name), { code: 'INVALID_INPUT' });
  assert.equal(outputName('报告.DOCX'), '报告.docx');
  assert.equal(outputName('报告'), '报告.docx');
});
test('invalid configuration fails at load', () => {
  for (const config of [{ concurrency: 0 }, { maxImages: Infinity }, { timeoutMs: 2 ** 32 }, { workspaceRoot: 'relative' }, { allowedReadRoots: ['relative'] }, { queueSize: -1 }]) assert.throws(() => resolveConfig(config));
});

test('configuration schema rejects fractional, out-of-range and unsafe resource limits', () => {
  for (const key of Object.keys(defaults)) {
    for (const value of [1.5, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => Config({ [key]: value }), `${key}=${value}`);
    if (key !== 'queueSize') assert.throws(() => Config({ [key]: 0 }), key);
  }
  assert.throws(() => Config({ timeoutMs: 2_147_483_648 }));
  assert.equal(Config({ queueSize: 0 }).queueSize, 0);
  assert.equal(Config({}).timeoutMs, defaults.timeoutMs);
});
test('markdown byte limits apply to text and to actual provider reads', async () => {
  const h = await harness({ maxMarkdownBytes: 4 });
  try {
    assert.equal((await h.call(source('汉字'))).error.info.code, 'LIMIT_EXCEEDED');
    await writeFile(path.join(h.root, 'too-large.md'), '12345');
    assert.equal((await h.call({ source: { kind: 'file', path: 'too-large.md' } })).error.info.code, 'FS_TOO_LARGE');
    await writeFile(path.join(h.root, 'invalid.md'), Buffer.from([0xff, 0xfe]));
    assert.equal((await h.call({ source: { kind: 'file', path: 'invalid.md' } })).error.info.code, 'FS_NOT_TEXT');
  } finally { await h.close(); }
});
test('inline images have bounded decoding and aggregate budgets', async () => {
  const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const md = `![inline](data:image/png;base64,${image.toString('base64')})`;
  const h = await harness({ maxImageBytes: image.length + 20, maxTotalImageBytes: image.length + 20 });
  try {
    const ok = await h.call(source(md));
    assert.equal(ok.isError, false, JSON.stringify(ok));
    assert.deepEqual(ok.value.warnings, []);
    // One image referenced repeatedly is read, decoded and budgeted once.
    const repeated = await h.call(source(`${md} ${md}`));
    assert.equal(repeated.isError, false, JSON.stringify(repeated));
    const other = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const limited = await h.call(source(`${md} ![other](data:image/png;base64,${other.toString('base64')})`));
    assert.equal(limited.error.info.code, 'LIMIT_EXCEEDED');
  } finally { await h.close(); }
});
test('non-session calls without workspaceRoot fail explicitly', async () => {
  const h = await harness({ workspaceRoot: undefined });
  try { assert.equal((await h.call(source('x'))).error.info.code, 'CONFIGURATION_ERROR'); }
  finally { await h.close(); }
});
test('output size and active conversion deadline are enforced', async () => {
  for (const config of [{ maxOutputBytes: 10 }, { timeoutMs: 1 }]) {
    const h = await harness(config);
    try { const result = await h.call(source('hello')); assert.equal(result.error.info.code, 'LIMIT_EXCEEDED', JSON.stringify(result)); }
    finally { await h.close(); }
  }
});
