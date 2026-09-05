import { constants } from 'node:fs';
import { copyFile, link, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageKeyForSha256 } from './storage-key.ts';

export async function commitDownloadedFile(tempPath: string, sha256: string, dataRoot: string): Promise<{ storageKey: string; absolutePath: string; existed: boolean }> {
  const storageKey = storageKeyForSha256(sha256);
  const absolutePath = join(dataRoot, storageKey);
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await stat(absolutePath);
    await unlink(tempPath).catch(() => undefined);
    return { storageKey, absolutePath, existed: true };
  } catch {}

  try {
    await link(tempPath, absolutePath);
    await unlink(tempPath);
    return { storageKey, absolutePath, existed: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      await unlink(tempPath).catch(() => undefined);
      return { storageKey, absolutePath, existed: true };
    }
    if (code === 'EXDEV' || code === 'EPERM') {
      try {
        await copyFile(tempPath, absolutePath, constants.COPYFILE_EXCL);
        await unlink(tempPath);
        return { storageKey, absolutePath, existed: false };
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
          await unlink(tempPath).catch(() => undefined);
          return { storageKey, absolutePath, existed: true };
        }
        throw copyError;
      }
    }
    throw error;
  }
}
