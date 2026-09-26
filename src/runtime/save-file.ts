import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpath, mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import { FsError } from '@deepseek-ai/dsh-fs';
import { outputName } from './paths.js';

/** Check the directory again immediately before each publication boundary.
 * Like DSH local containment, this is a trusted-code path fence, not a kernel
 * sandbox against an external process swapping ancestor directories concurrently.
 */
async function checkDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new FsError('Output must be a real project directory, not a symbolic link.', 'FS_SANDBOX_DENIED');
}

/** Exclusive create for filesystems without hard links: never overwrites (false when
 * the name exists) and on failure removes only the file this call created. Not atomic.
 */
export async function writeExclusive(file: string, data: Uint8Array, signal: AbortSignal): Promise<boolean> {
  let handle;
  try { handle = await open(file, 'wx', 0o666); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  try {
    try { await handle.writeFile(data, { signal }); await handle.sync(); } finally { await handle.close(); }
    return true;
  } catch (error) {
    await unlink(file).catch(() => {});
    throw error;
  }
}

export async function saveFile(directory: string, name: string, data: Uint8Array, signal: AbortSignal): Promise<string> {
  outputName(name);
  signal.throwIfAborted();
  try {
    try { await mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await checkDirectory(directory);
    const temporary = path.join(directory, `.md2word-${randomUUID()}.tmp`);
    // Ordinary document permissions: the process umask applies, as for any saved file.
    const file = await open(temporary, 'wx', 0o666);
    try {
      try { await file.writeFile(data, { signal }); await file.sync(); } finally { await file.close(); }
      for (let suffix = 0; suffix < 1000; suffix++) {
        signal.throwIfAborted();
        await checkDirectory(directory);
        const candidate = path.join(directory, suffix === 0 ? name : `${name.slice(0, -5)} (${suffix}).docx`);
        try {
          // link publishes the complete file atomically and never overwrites.
          await link(temporary, candidate);
          return candidate;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') continue;
          if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'].includes(code ?? '')) throw error;
        }
        // Filesystems without hard links (exFAT, some network shares).
        if (await writeExclusive(candidate, data, signal)) return candidate;
      }
      throw new FsError('Too many existing files with this export name.', 'FS_IO_ERROR');
    } finally { await unlink(temporary); }
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof FsError) throw cause;
    const code = (cause as NodeJS.ErrnoException).code;
    throw new FsError('Could not save the DOCX in the project output directory.', code === 'EACCES' || code === 'EPERM' ? 'FS_PERMISSION_DENIED' : 'FS_IO_ERROR', { cause });
  }
}
