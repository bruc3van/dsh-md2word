import { Worker } from 'node:worker_threads';
import type { Limits } from '../config.js';
import type { ImageReference } from '../core/markdown.js';
import type { AcquiredImage } from '../core/convert.js';
import type { Diagnostic } from '../core/diagnostics.js';
import { ExportError } from './errors.js';
/** Heap ceiling for one conversion; in attachment delivery the worker shares the host process. */
export const WORKER_HEAP_MB = 4096;
/** Transfer only buffers that own their whole ArrayBuffer (never Node's shared Buffer pool). */
export function transferable(views: Uint8Array[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const view of views) if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) buffers.add(view.buffer);
  return [...buffers];
}
export async function runWorker(markdown: string, limits: Limits, signal: AbortSignal, acquire: (refs: ImageReference[], signal: AbortSignal) => Promise<{ assets: AcquiredImage[]; warnings: Diagnostic[] }>): Promise<{ data: Uint8Array; warnings: Diagnostic[] }> {
  signal.throwIfAborted();
  const lifetime = new AbortController();
  const ioSignal = AbortSignal.any([signal, lifetime.signal]);
  // Node 25+ exposes a localStorage getter that warns when a dependency probes it;
  // conversion never uses Web Storage, and stray warnings would corrupt CLI stderr.
  const worker = new Worker(new URL('./worker-entry.js', import.meta.url), { workerData: { markdown, limits }, execArgv: ['--no-experimental-webstorage'], resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  let pendingAcquisition: Promise<void> | undefined;
  let abort: () => void = () => {};
  try {
    return await new Promise((resolve, reject) => {
      let receivedImages = false;
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? new ExportError('Conversion exceeded the worker memory limit; split or simplify the document.', 'LIMIT_EXCEEDED', { cause: error })
        : new ExportError('Conversion worker failed.', 'CONVERSION_FAILED', { cause: error })));
      worker.on('exit', () => reject(new ExportError('Conversion worker exited before delivering a result.', 'CONVERSION_FAILED')));
      worker.on('message', (message: { type: string; images?: ImageReference[]; data?: Uint8Array; warnings?: Diagnostic[]; code?: string; message?: string }) => {
        if (signal.aborted) return;
        if (message.type === 'images' && !receivedImages && Array.isArray(message.images)) {
          receivedImages = true;
          pendingAcquisition = acquire(message.images, ioSignal).then(result => { if (!signal.aborted) worker.postMessage(result, transferable(result.assets.map(asset => asset.data))); }, reject);
        } else if (message.type === 'result' && receivedImages && message.data instanceof Uint8Array && Array.isArray(message.warnings)) resolve({ data: message.data, warnings: message.warnings });
        else if (message.type === 'error') reject(new ExportError(message.message ?? 'Conversion failed.', message.code === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' : 'CONVERSION_FAILED'));
        else reject(new ExportError('Invalid conversion worker message.', 'CONVERSION_FAILED'));
      });
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener('abort', abort);
    lifetime.abort(new DOMException('Conversion worker stopped.', 'AbortError'));
    await worker.terminate();
    await pendingAcquisition;
  }
}
