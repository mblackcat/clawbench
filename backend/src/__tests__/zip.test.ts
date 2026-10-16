import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipDirectory, readZipEntry, validatePackageManifestId } from '../utils/zip';

describe('Zip utilities', () => {
  let testDir: string;
  let testSourceDir: string;
  let testZipPath: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-zip-test-'));
    testSourceDir = path.join(testDir, 'source');
    testZipPath = path.join(testDir, 'test.zip');
    fs.mkdirSync(path.join(testSourceDir, 'nested', '__pycache__'), { recursive: true });
    fs.writeFileSync(
      path.join(testSourceDir, 'manifest.json'),
      JSON.stringify({ id: 'cb.test.app', name: '测试应用' })
    );
    fs.writeFileSync(path.join(testSourceDir, 'main.py'), 'print("hi")');
    fs.writeFileSync(path.join(testSourceDir, 'nested', 'README.md'), '# nested');
    fs.writeFileSync(path.join(testSourceDir, 'nested', '__pycache__', 'x.pyc'), 'junk');
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('packs a directory and reads entries back', async () => {
    await zipDirectory(testSourceDir, testZipPath);
    expect(fs.existsSync(testZipPath)).toBe(true);

    const manifest = JSON.parse(readZipEntry(testZipPath, 'manifest.json')!);
    expect(manifest.id).toBe('cb.test.app');
    expect(manifest.name).toBe('测试应用');

    expect(readZipEntry(testZipPath, 'main.py')).toBe('print("hi")');
    expect(readZipEntry(testZipPath, 'README.md')).toBe('# nested');
    expect(readZipEntry(testZipPath, 'x.pyc')).toBeNull();
    expect(readZipEntry(testZipPath, 'no-such-file.txt')).toBeNull();
  });

  it('accepts a buffer and returns null for non-zip input', () => {
    const buffer = fs.readFileSync(testZipPath);
    expect(readZipEntry(buffer, 'main.py')).toBe('print("hi")');
    expect(readZipEntry(Buffer.from('not a zip at all'), 'main.py')).toBeNull();
    expect(readZipEntry(Buffer.alloc(0), 'main.py')).toBeNull();
    expect(readZipEntry(path.join(testDir, 'missing.zip'), 'main.py')).toBeNull();
  });

  async function zipWith(files: Record<string, string>): Promise<Buffer> {
    const dir = fs.mkdtempSync(path.join(testDir, 'pkg-'));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const out = path.join(testDir, `${path.basename(dir)}.zip`);
    await zipDirectory(dir, out);
    return fs.readFileSync(out);
  }

  it('caps decompressed entry size (zip bomb guard)', async () => {
    const zip = await zipWith({ 'big.txt': 'a'.repeat(200_000) });
    expect(readZipEntry(zip, 'big.txt')).toHaveLength(200_000);
    expect(readZipEntry(zip, 'big.txt', { maxOutputLength: 1000 })).toBeNull();
  });

  it('validates the manifest id of uploaded packages leniently', async () => {
    expect(validatePackageManifestId(await zipWith({ 'manifest.json': '{"id":"cb.ok.app"}' }))).toBeNull();
    expect(validatePackageManifestId(await zipWith({ 'main.py': 'x' }))).toBeNull();
    expect(validatePackageManifestId(await zipWith({ 'manifest.json': '{"name":"no id"}' }))).toBeNull();
    for (const bad of ['../evil', 'a/b', '.hidden', 'a..b', '']) {
      const zip = await zipWith({ 'manifest.json': JSON.stringify({ id: bad }) });
      expect(validatePackageManifestId(zip)).toMatch(/Invalid manifest id/);
    }
  });
});
