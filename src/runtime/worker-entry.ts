import { parentPort, workerData } from 'node:worker_threads';
import { parseMarkdown } from '../core/markdown.js';
import { convert } from '../core/convert.js';
import type { AcquiredImage } from '../core/convert.js';
import type { Diagnostic } from '../core/diagnostics.js';
import type { Limits } from '../config.js';
import { validateArtifact } from './artifact.js';
import { transferable } from './worker-client.js';
const port = parentPort!;
const { markdown, limits } = workerData as { markdown: string; limits: Limits };
async function run(): Promise<void> {
  const parsed = parseMarkdown(markdown, limits);
  const assets = new Promise<{ assets: AcquiredImage[]; warnings: Diagnostic[] }>(resolve => port.once('message', resolve));
  port.postMessage({ type: 'images', images: parsed.images });
  const acquired = await assets;
  const result = await convert(parsed, acquired.assets, acquired.warnings, limits);
  await validateArtifact(result.data, limits.maxOutputBytes);
  port.postMessage({ type: 'result', ...result }, transferable([result.data]));
  port.close();
}
run().catch((error: unknown) => {
  port.postMessage({ type: 'error', code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'CONVERSION_FAILED', message: error instanceof Error ? error.message.slice(0, 300) : 'Conversion failed.' });
  port.close();
});
