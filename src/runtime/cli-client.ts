import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-shell';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { ResolvedConfig } from '../config.js';
import { defaults } from '../config.js';
import type { WordExportInput } from './paths.js';
import type { Diagnostic } from '../core/diagnostics.js';
import { ExportError, ContentIncompleteError } from './errors.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function bundledCommand(): string {
  const windows = process.platform === 'win32';
  const quote = (value: string) => "'" + value.replaceAll("'", windows ? "''" : "'\\''") + "'";
  const entry = fileURLToPath(new URL('../cli.js', import.meta.url));
  return `${windows ? '& ' : ''}${quote(process.execPath)} ${quote(entry)}`;
}

function validDiagnostics(value: unknown, limit: number): value is Diagnostic[] {
  return Array.isArray(value) && value.length <= limit && value.every(w => w
    && typeof w.code === 'string' && /^[A-Z_]{1,64}$/.test(w.code)
    && typeof w.message === 'string' && w.message.length <= 300
    && ['info', 'degradation'].includes(w.severity)
    && (w.line === undefined || Number.isSafeInteger(w.line) && w.line > 0));
}

export interface CliResult { path: string; fileName: string; mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; sizeBytes: number; warnings: Diagnostic[] }
export async function runCli(ctx: Context, args: WordExportInput, exec: ToolExecution, config: ResolvedConfig, signal: AbortSignal): Promise<CliResult> {
  const shell = ctx.get('shell');
  if (!shell) throw new ExportError('Project delivery requires the DSH shell executor.', 'CONFIGURATION_ERROR');
  const cwd = exec.agent?.session.header.cwd ?? config.workspaceRoot;
  if (!cwd || !path.isAbsolute(cwd)) throw new ExportError('An absolute session cwd or workspaceRoot is required.', 'CONFIGURATION_ERROR');
  const policyService = ctx.get('sandboxPolicy');
  if (shell.sandboxMode !== undefined && !policyService) throw new ExportError('The confining shell executor requires sandboxPolicy.', 'CONFIGURATION_ERROR');
  const sandboxPolicy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {});
  const options = { ...Object.fromEntries(Object.keys(defaults).map(key => [key, config[key as keyof typeof defaults]])), allowedReadRoots: config.allowedReadRoots };
  const stdin = JSON.stringify({ protocol: 1, input: args, config: options });
  if (Buffer.byteLength(stdin) > 32 * 1024 * 1024) throw new ExportError('CLI request exceeds the transport limit.', 'LIMIT_EXCEEDED');
  const spec = shell.resolve({
    // Only administrator configuration becomes shell syntax. Model-controlled
    // paths, Markdown and filenames travel exclusively through stdin.
    command: `${config.cliCommand ?? bundledCommand()} --request`, stdin, workdir: cwd,
    signal, timeoutMs: config.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 1024 * 1024, sandboxPolicy,
  });
  const result = await (await shell.execute(spec)).result();
  signal.throwIfAborted();
  if (result.sandbox?.denied) throw new HarnessError('DOCX export was denied by the shell sandbox.', 'FS_SANDBOX_DENIED');
  if (result.sandbox?.runnerFailed) throw new ExportError('The configured sandbox runner failed to start DOCX export.', 'CONFIGURATION_ERROR');
  if (result.timedOut) throw new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED');
  if (result.aborted) throw new DOMException('CLI export canceled.', 'AbortError');
  if (result.exitCode !== 0) {
    // Node/native libraries may emit warning lines before or after our JSON.
    // Only accept the versioned CLI envelope; do not expose arbitrary stderr.
    for (const line of result.stderr.text.split(/\r?\n/).reverse()) {
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      const reported = envelope?.error;
      if (envelope?.protocol === 1 && typeof reported?.code === 'string' && /^[A-Z_]{1,64}$/.test(reported.code) && typeof reported.message === 'string') {
        if (reported.code === 'CONTENT_INCOMPLETE' && reported.diagnostics !== undefined) {
          if (!validDiagnostics(reported.diagnostics, config.maxDiagnostics)) throw new ExportError('CLI returned invalid error diagnostics.', 'CONVERSION_FAILED');
          throw new ContentIncompleteError(reported.diagnostics);
        }
        throw new HarnessError(reported.message.slice(0, 500), reported.code);
      }
    }
    throw new ExportError(`CLI exited without a valid error response (exit code: ${result.exitCode ?? 'unknown'}).`, 'CONVERSION_FAILED');
  }
  if (result.stdout.truncated) throw new ExportError('CLI result exceeded the response limit.', 'LIMIT_EXCEEDED');
  let value: CliResult & { protocol: number };
  try { value = JSON.parse(result.stdout.text); } catch { throw new ExportError('CLI returned invalid JSON.', 'CONVERSION_FAILED'); }
  if (!value || value.protocol !== 1 || typeof value.path !== 'string' || !value.path || typeof value.fileName !== 'string'
    || value.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > config.maxOutputBytes
    || !validDiagnostics(value.warnings, config.maxDiagnostics)) throw new ExportError('CLI returned an invalid export result.', 'CONVERSION_FAILED');
  return { path: value.path, fileName: value.fileName, mimeType: value.mimeType, sizeBytes: value.sizeBytes, warnings: value.warnings };
}
