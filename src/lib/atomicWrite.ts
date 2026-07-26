import { promises as fs } from "fs";
import path from "path";

/**
 * Write a file so a reader never sees a half-written one.
 *
 * The plain fs.writeFile truncates the existing file to zero bytes and THEN
 * streams the new content in. For the documents this app keeps — a store's
 * whole DB (~1.5 MB, rewritten on every single sale) and the 4,250-product
 * master catalogue — that leaves a window on every write where the file on disk
 * is empty or partial. Anything that kills the process inside it (a Render
 * deploy's SIGKILL, an OOM kill — this service has had them) leaves a truncated
 * file, and a truncated JSON file does not fail softly: it throws on parse, so
 * the store cannot open at all until someone restores a backup.
 *
 * Temp file in the SAME directory (rename is only atomic within one
 * filesystem) → fsync so the bytes are durable → rename over the target. A
 * reader gets either the whole old file or the whole new one.
 */
export async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // pid + counter so two concurrent writers can't collide on the same temp name.
  const tmp = `${file}.${process.pid}.${(seq = (seq + 1) % 1e6)}.tmp`;
  try {
    const fh = await fs.open(tmp, "w");
    try {
      await fh.writeFile(contents, "utf8");
      await fh.sync(); // durable BEFORE it becomes the live file
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, file);
  } catch (err) {
    // Never leave a stray .tmp behind on a full or failing disk.
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
let seq = 0;
