import { existsSync, renameSync, unlinkSync } from 'node:fs';

/** Promote a validated same-directory temp file, replacing an existing target on Windows. */
export function promoteJsonTempFile(tmpFile: string, filePath: string): void {
  try {
    renameSync(tmpFile, filePath);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const canReplaceOnWindows = process.platform === 'win32'
      && existsSync(filePath)
      && (code === 'EPERM' || code === 'EEXIST' || code === 'EACCES');
    if (!canReplaceOnWindows) throw err;

    const displacedFile = `${filePath}.replace`;
    if (existsSync(displacedFile)) unlinkSync(displacedFile);
    renameSync(filePath, displacedFile);
    try {
      renameSync(tmpFile, filePath);
    } catch (promotionError) {
      try {
        renameSync(displacedFile, filePath);
      } catch (restoreError) {
        const promotionMessage = promotionError instanceof Error ? promotionError.message : String(promotionError);
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
        throw new Error(`Failed to promote ${tmpFile} and restore ${filePath}: ${promotionMessage}; ${restoreMessage}`, { cause: restoreError });
      }
      throw promotionError;
    }
    try { unlinkSync(displacedFile); } catch { /* best effort */ }
  }
}
