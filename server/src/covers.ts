import fs from 'node:fs';
import path from 'node:path';

function extForMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

/** Persist a cover image for an item and return the stored filename (relative to coversDir). */
export function saveCover(coversDir: string, itemId: number, data: Buffer, mimeType: string): string {
  // Remove any previous cover with a different extension.
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const p = path.join(coversDir, `${itemId}.${ext}`);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  const name = `${itemId}.${extForMime(mimeType)}`;
  fs.writeFileSync(path.join(coversDir, name), data);
  return name;
}

export function coverImageInDir(dir: string): { data: Buffer; mimeType: string } | undefined {
  const candidates = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png', 'cover.webp'];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      const ext = path.extname(p).slice(1);
      return { data: fs.readFileSync(p), mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
    }
  }
  return undefined;
}
