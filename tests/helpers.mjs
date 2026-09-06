import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
export async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gwb-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
// Independent ZIP reader for test assertions; no new runtime dependency.
export async function readZip(file) {
  const bytes = await fs.readFile(file);
  const result = new Map();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + size);
    result.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return result;
}
