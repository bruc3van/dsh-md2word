#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { resolveConfig, defaults, type Config } from './config.js';
import { readInput, outputName, type WordExportInput } from './runtime/paths.js';
import { acquireImages } from './runtime/assets.js';
import { runWorker } from './runtime/worker-client.js';
import { saveFile } from './runtime/save-file.js';
import { ExportError, ContentIncompleteError } from './runtime/errors.js';

const help = `Usage: bruce-md2word <input.md | -> [-o output.docx] [--strict] [--asset-base-dir directory]

Convert UTF-8 Markdown to editable DOCX. '-' reads Markdown from stdin.
Default output: ./output/<input-name>.docx (document.docx for stdin).
Existing files are never overwritten; collisions add a numeric suffix.
Success is reported as JSON on stdout; errors are JSON on stderr.
--version, -v prints the package version and exits without converting.
--request reads a versioned plugin request from stdin; it always saves in ./output/.
Node.js 24 or 26 required. No Office, Python or external converter is needed.
`;
const controller = new AbortController();
let signaled = false;
const onSignal = () => { signaled = true; controller.abort(new DOMException('Export canceled.', 'AbortError')); };
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
let timer: ReturnType<typeof setTimeout> | undefined;

async function stdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const abort = () => process.stdin.destroy(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  try {
    controller.signal.throwIfAborted();
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new ExportError('Standard input exceeds the byte limit.', 'LIMIT_EXCEEDED');
      chunks.push(Buffer.from(chunk));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { controller.signal.removeEventListener('abort', abort); }
}

function validateInput(value: unknown): WordExportInput {
  if (!value || typeof value !== 'object') throw new ExportError('Invalid conversion request.', 'INVALID_INPUT');
  const input = value as WordExportInput;
  if (!input.source || !['file', 'markdown'].includes(input.source.kind)
    || input.source.kind === 'file' && typeof input.source.path !== 'string'
    || input.source.kind === 'markdown' && (typeof input.source.text !== 'string' || input.source.assetBaseDir !== undefined && typeof input.source.assetBaseDir !== 'string')
    || input.fileName !== undefined && typeof input.fileName !== 'string'
    || input.strict !== undefined && typeof input.strict !== 'boolean') throw new ExportError('Invalid conversion request.', 'INVALID_INPUT');
  return input;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string', short: 'o' }, strict: { type: 'boolean' }, 'asset-base-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, request: { type: 'boolean' },
  } });
  if (values.help) { process.stdout.write(help); return; }
  if (values.version) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(manifest.version + '\n');
    return;
  }
  const startedAt = Date.now();
  timer = setTimeout(() => controller.abort(new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED')), defaults.timeoutMs);
  let input: WordExportInput;
  let config: Config = { workspaceRoot: process.cwd() };
  if (values.request) {
    if (positionals.length || values.output || values.strict || values['asset-base-dir']) throw new ExportError('--request cannot be combined with conversion arguments.', 'INVALID_INPUT');
    const envelope = JSON.parse(await stdin(32 * 1024 * 1024));
    if (envelope?.protocol !== 1 || !envelope.config || typeof envelope.config !== 'object') throw new ExportError('Unsupported CLI request protocol.', 'INVALID_INPUT');
    input = validateInput(envelope.input);
    config = { ...envelope.config, workspaceRoot: process.cwd() };
  } else {
    if (positionals.length !== 1) throw new ExportError('Expected one input file or -. Use --help for usage.', 'INVALID_INPUT');
    if (positionals[0] !== '-' && values['asset-base-dir']) throw new ExportError('--asset-base-dir applies only to stdin; file images are relative to the input file.', 'INVALID_INPUT');
    input = { source: positionals[0] === '-' ? { kind: 'markdown', text: await stdin(defaults.maxMarkdownBytes), ...(values['asset-base-dir'] ? { assetBaseDir: values['asset-base-dir'] } : {}) } : { kind: 'file', path: positionals[0] }, strict: values.strict };
    if (input.source.kind === 'file') config.allowedReadRoots = [path.dirname(path.resolve(input.source.path))];
    if (values['asset-base-dir']) config.allowedReadRoots = [...config.allowedReadRoots ?? [], path.resolve(values['asset-base-dir'])];
    if (values.output) input.fileName = outputName(path.basename(values.output));
  }
  const limits = resolveConfig(config);
  clearTimeout(timer);
  controller.signal.throwIfAborted();
  const remaining = limits.timeoutMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED');
  timer = setTimeout(() => controller.abort(new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED')), remaining);
  const ctx = new Context();
  try {
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() });
    const signal = controller.signal;
    const source = await readInput(ctx.fs, input, {} as never, limits, signal);
    const result = await runWorker(source.markdown, limits, signal, (refs, ioSignal) => acquireImages(ctx.fs, refs, source, limits, ioSignal));
    signal.throwIfAborted();
    if (input.strict && result.warnings.some(w => w.severity === 'degradation')) throw new ContentIncompleteError(result.warnings);
    const requestedDir = values.output ? path.dirname(path.resolve(values.output)) : path.resolve('output');
    // An explicit -o directory is the user's choice, so resolve aliases such as
    // macOS /tmp. The default ./output (also used by --request) must not be a
    // redirected directory. Publication checks repeat immediately before the syscall.
    const explicit = values.output ? await realpath(requestedDir).catch(error => { if (error.code !== 'ENOENT') throw error; }) : undefined;
    const directory = explicit ?? path.join(await realpath(path.dirname(requestedDir)), path.basename(requestedDir));
    signal.throwIfAborted();
    const saved = await saveFile(directory, source.fileName, result.data, signal);
    signal.throwIfAborted();
    process.stdout.write(JSON.stringify({ protocol: 1, path: saved, fileName: path.basename(saved), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: result.data.byteLength, warnings: result.warnings }) + '\n');
  } finally { await ctx.fiber.dispose(); }
}

try { await main(); }
catch (cause) {
  const error = (controller.signal.aborted ? controller.signal.reason : cause) as { code?: unknown; name?: string; message?: string };
  // DOMException exposes a numeric legacy code; the protocol reports string codes only.
  const code = typeof error?.code === 'string' ? error.code : error?.name === 'AbortError' ? 'ABORTED' : 'CONVERSION_FAILED';
  process.stderr.write(JSON.stringify({ protocol: 1, error: { code, message: (error?.message ?? 'Conversion failed.').slice(0, 500), ...(error instanceof ContentIncompleteError ? { diagnostics: error.diagnostics } : {}) } }) + '\n');
  process.exitCode = signaled ? 130 : 1;
} finally {
  clearTimeout(timer);
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
}
