// Pure cryptographic format checks; never connects to an API or uses real keys.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('../frontend/node_modules/typescript');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/src/app/core/services/secret-files.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  for (const size of [0, 1, m.SECRET_CHUNK - 1, m.SECRET_CHUNK, m.SECRET_CHUNK + 1]) {
    const file = new File([new Uint8Array(size).fill(73)], 'synthetic.bin');
    const a = m.describeFile(file), key = await m.fileCipher(a);
    let total = 0;
    for (let i = 0; i < a.chunks; i++) {
      const ciphertext = await m.encryptFileChunk(a, key, file, i);
      const plain = await m.decryptFileChunk(a, key, ciphertext, i);
      assert(plain.every(b => b === 73)); total += plain.length;
      const damaged = ciphertext.slice(0); new Uint8Array(damaged)[0] ^= 1;
      await assert.rejects(m.decryptFileChunk(a, key, damaged, i));
      await assert.rejects(m.decryptFileChunk(a, key, ciphertext.slice(1), i));
      await assert.rejects(m.decryptFileChunk({ ...a, id: crypto.randomUUID() }, key, ciphertext, i));
      const wrongKey = await m.fileCipher(m.describeFile(file));
      await assert.rejects(m.decryptFileChunk(a, wrongKey, ciphertext, i));
    }
    assert.equal(total, size);
  }
  // Exercise a maximum-size virtual file without allocating 500 MiB at once.
  const size = m.SECRET_MAX_FILE;
  let largestRead = 0;
  const virtual = { size, name: 'large-synthetic.bin', type: 'application/octet-stream', slice(start, end) {
    const length = Math.min(end, size) - start; largestRead = Math.max(largestRead, length);
    return { arrayBuffer: async () => new Uint8Array(length).fill(start / m.SECRET_CHUNK % 256).buffer };
  } };
  const a = m.describeFile(virtual), key = await m.fileCipher(a);
  for (let i = 0; i < a.chunks; i++) {
    const ciphertext = await m.encryptFileChunk(a, key, virtual, i);
    const plain = await m.decryptFileChunk(a, key, ciphertext, i);
    assert.equal(plain.length, m.SECRET_CHUNK); assert.equal(plain[0], i % 256);
    if (i === 0) await assert.rejects(m.decryptFileChunk(a, key, ciphertext, 1));
  }
  assert.equal(largestRead, m.SECRET_CHUNK);
  assert.throws(() => m.describeFile({ ...virtual, size: size + 1 }));
  console.log('Secret files: boundaries, authentication, truncation, swapped chunks/keys/IDs and bounded 500 MiB roundtrip passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
