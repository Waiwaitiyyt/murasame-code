import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** Write beside the destination so rename replaces it atomically on the same filesystem. */
export function writePrivateFileAtomic(file: string, content: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let created = false;
  try {
    // Exclusive creation avoids reusing an existing file or following a symlink.
    const descriptor = openSync(temporary, 'wx', 0o600);
    created = true;
    try {
      writeFileSync(descriptor, content, 'utf8');
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
  } finally {
    if (created) {
      try { unlinkSync(temporary); }
      catch {
        // A successful rename already removed it; cleanup must preserve the original error.
      }
    }
  }
}
