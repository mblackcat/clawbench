/**
 * Zip helpers implemented in pure Node.js (archiver + zlib) so the server does not
 * depend on system `zip` / `unzip` binaries being installed.
 */
import fs from 'fs';
import zlib from 'zlib';
import archiver from 'archiver';

/**
 * Packs the contents of `sourceDir` (without the directory itself) into a zip file.
 * Python caches and .DS_Store files are skipped.
 * @param sourceDir directory to pack
 * @param destZip   absolute path of the output zip
 */
export function zipDirectory(sourceDir: string, destZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      // ENOENT warnings (file vanished while packing) are not fatal
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err);
    });

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: sourceDir,
      dot: false,
      ignore: ['__pycache__/**', '**/__pycache__/**', '*.pyc', '**/*.pyc', '.DS_Store', '**/.DS_Store'],
    });
    void archive.finalize();
  });
}

/**
 * Reads the text content of an entry from a zip archive (stored or deflated entries).
 * Matches `targetName` exactly or as the basename of a nested path (`dir/targetName`).
 * Zip64 archives are not supported.
 *
 * @param zipPathOrBuffer zip file path or buffer
 * @param targetName      entry name, e.g. "manifest.json"
 * @returns entry content, or null when not found / unreadable
 */
export function readZipEntry(zipPathOrBuffer: string | Buffer, targetName: string): string | null {
  try {
    const buffer =
      typeof zipPathOrBuffer === 'string' ? fs.readFileSync(zipPathOrBuffer) : zipPathOrBuffer;
    if (buffer.length < 22) return null;

    // Locate End Of Central Directory record (0x06054b50); the trailing comment is at most 64 KiB
    let eocdOffset = -1;
    const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
    for (let i = buffer.length - 22; i >= minOffset; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return null;

    const cdEntries = buffer.readUInt16LE(eocdOffset + 10);
    let pos = buffer.readUInt32LE(eocdOffset + 16);

    for (let i = 0; i < cdEntries; i++) {
      if (pos + 46 > buffer.length) break;
      if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
      const compression = buffer.readUInt16LE(pos + 10);
      const compressedSize = buffer.readUInt32LE(pos + 20);
      const fileNameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localHeaderOffset = buffer.readUInt32LE(pos + 42);
      const fileName = buffer.toString('utf8', pos + 46, pos + 46 + fileNameLen);
      pos += 46 + fileNameLen + extraLen + commentLen;

      if (fileName !== targetName && !fileName.endsWith('/' + targetName)) continue;

      if (localHeaderOffset + 30 > buffer.length) return null;
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;
      const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
      const dataSlice = buffer.subarray(dataOffset, dataOffset + compressedSize);

      if (compression === 0) return dataSlice.toString('utf8');
      if (compression === 8) return zlib.inflateRawSync(dataSlice).toString('utf8');
      return null;
    }
  } catch {
    // unreadable / corrupt archive
  }
  return null;
}
