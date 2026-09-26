import path from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { FsError } from '@deepseek-ai/dsh-fs';
import type { ImageReference } from '../core/markdown.js';
import type { AcquiredImage } from '../core/convert.js';
import type { Limits } from '../config.js';
import { Diagnostics } from '../core/diagnostics.js';
import { ExportError } from './errors.js';
import type { InputData } from './paths.js';
export async function acquireImages(fs: FileSystem, refs: ImageReference[], input: InputData, limits: Limits, signal: AbortSignal): Promise<{ assets: AcquiredImage[]; warnings: Diagnostics['items'] }> {
  if (refs.length > limits.maxImages) throw new ExportError('Image count exceeds the configured limit.', 'LIMIT_EXCEEDED');
  const diagnostics = new Diagnostics(limits.maxDiagnostics);
  const assets: AcquiredImage[] = [];
  let total = 0;
  // Repeated references read and count one image once; the worker decodes it once too.
  const acquired = new Map<string, Uint8Array>();
  for (const ref of refs) {
    signal.throwIfAborted();
    const previous = acquired.get(ref.src);
    if (previous) { assets.push({ id: ref.id, data: previous }); continue; }
    let data: Uint8Array | undefined;
    const unavailable = (message: string): void => diagnostics.add('IMAGE_UNAVAILABLE', message, 'degradation', ref.line);
    if (/^data:/i.test(ref.src)) {
      const match = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(ref.src);
      if (!match || !match[2] || match[2].length % 4 !== 0) { unavailable('Invalid or unsupported embedded image; alternative text retained.'); continue; }
      if (match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) > limits.maxImageBytes) throw new ExportError('Embedded image exceeds the configured limit.', 'LIMIT_EXCEEDED');
      data = Buffer.from(match[2], 'base64');
      if (Buffer.from(data).toString('base64') !== match[2]) { unavailable('Invalid embedded image encoding; alternative text retained.'); continue; }
    } else {
      let relative: string;
      try { relative = decodeURIComponent(ref.src); } catch { unavailable('Invalid image path encoding; alternative text retained.'); continue; }
      if (!relative || /^[a-z][a-z0-9+.-]*:/i.test(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) { unavailable('Remote, absolute or invalid image path was not read; alternative text retained.'); continue; }
      if (!input.assetBase || !input.assetRoot) { unavailable('Relative image needs assetBaseDir; alternative text retained.'); continue; }
      const lexical = path.relative(input.assetBase, path.resolve(input.assetBase, relative));
      if (lexical === '..' || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) { unavailable('Image is outside the document directory; alternative text retained.'); continue; }
      try {
        const target = await fs.resolve(relative, { cwd: input.assetBase, signal });
        if (!fs.contains(input.assetRoot, target)) { unavailable('Image resolves outside the document directory; alternative text retained.'); continue; }
        const info = await fs.stat(target, signal);
        if (!info || info.type !== 'file') { unavailable('Image is missing or is not a regular file; alternative text retained.'); continue; }
        if (info.size !== undefined && info.size > limits.maxImageBytes) throw new ExportError('Image exceeds the configured byte limit.', 'LIMIT_EXCEEDED');
        data = await fs.readBytes(target, signal, limits.maxImageBytes);
      } catch (error) {
        if (error instanceof FsError && error.code === 'FS_NOT_FOUND') { unavailable('Image disappeared before reading; alternative text retained.'); continue; }
        throw error;
      }
    }
    total += data.byteLength;
    if (data.byteLength > limits.maxImageBytes || total > limits.maxTotalImageBytes) throw new ExportError('Image bytes exceed the configured limit.', 'LIMIT_EXCEEDED');
    acquired.set(ref.src, data);
    assets.push({ id: ref.id, data });
  }
  return { assets, warnings: diagnostics.items };
}
