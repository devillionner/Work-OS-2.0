// Шифрування архіву входів runner без зовнішніх програм і залежностей: scrypt (N=2^17) → AES-256-GCM по шматках 4 МіБ.
// Кожен шматок має власний тег автентичності; номер шматка (nonce) і ознака «останній» входять у перевірку, тож перестановка, обрізання
// й підміна виявляються. Неправильний пароль чи пошкодження видно на першому ж шматку, до будь-якого розпакування.
// Формат: "WOSV1\n" · salt(16) · chunkSize(u32) · log2N(u8) · r(u8) · p(u8) · шматки [довжина u32 (старший біт — «останній»)] [шифротекст] [тег 16].
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { once } from 'node:events';

const MAGIC = Buffer.from('WOSV1\n');
const CHUNK = 4 * 1024 * 1024;
const LOG2N = 17;
const R = 8;
const P = 1;
const TAG = 16;
const FINAL = 0x80000000;
const HEADER = MAGIC.length + 16 + 4 + 3;

export class VaultError extends Error {
  constructor(message, code) { super(message); this.name = 'VaultError'; this.code = code; }
}

function deriveKey(password, salt, log2n, r, p) {
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(password, 'utf8'), salt, 32, { N: 2 ** log2n, r, p, maxmem: 512 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
const nonceFor = (index) => { const nonce = Buffer.alloc(12); nonce.writeBigUInt64BE(BigInt(index), 4); return nonce; };
const aadFor = (header, final) => Buffer.concat([header, Buffer.from([final ? 1 : 0])]);

/**
 * Шифрує потік у файл. Повертає розмір і SHA-256 готового файлу (для порівняння після вивантаження й завантаження).
 * @param {AsyncIterable<Buffer>} source
 */
export async function encryptToFile(source, outPath, password, { onBytes } = {}) {
  if (!password) throw new VaultError('Порожній пароль.', 'empty_password');
  const salt = randomBytes(16);
  const header = Buffer.concat([MAGIC, salt, Buffer.from([0, 0, 0, 0]), Buffer.from([LOG2N, R, P])]);
  header.writeUInt32BE(CHUNK, MAGIC.length + 16);
  const key = await deriveKey(password, salt, LOG2N, R, P);
  const out = createWriteStream(outPath, { mode: 0o600 });
  const hash = createHash('sha256');
  let size = 0;
  const write = async (buffer) => {
    hash.update(buffer); size += buffer.length;
    if (!out.write(buffer)) await once(out, 'drain');
  };
  await write(header);
  let index = 0;
  let pending = [];
  let pendingBytes = 0;
  const seal = async (data, final) => {
    const cipher = createCipheriv('aes-256-gcm', key, nonceFor(index), { authTagLength: TAG });
    cipher.setAAD(aadFor(header, final));
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE((body.length | (final ? FINAL : 0)) >>> 0);
    await write(Buffer.concat([length, body, cipher.getAuthTag()]));
    index += 1;
  };
  try {
    for await (const piece of source) {
      onBytes?.(piece.length);
      pending.push(piece); pendingBytes += piece.length;
      while (pendingBytes >= CHUNK) {
        const all = Buffer.concat(pending);
        await seal(all.subarray(0, CHUNK), false);
        const rest = all.subarray(CHUNK);
        pending = rest.length ? [rest] : []; pendingBytes = rest.length;
      }
    }
    await seal(Buffer.concat(pending), true);
    out.end();
    await once(out, 'finish');
  } catch (error) {
    out.destroy();
    throw error;
  }
  return { size, sha256: hash.digest('hex') };
}

/** Читає й перевіряє файл, віддаючи відкритий текст шматками (генератор). Помилка виявляється до того, як перший байт піде далі. */
export async function* decryptFile(path, password, { onBytes } = {}) {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(HEADER);
    const { bytesRead } = await handle.read(head, 0, HEADER, 0);
    if (bytesRead < HEADER || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultError('Це не архів Work OS або файл пошкоджено.', 'bad_format');
    const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
    const chunkSize = head.readUInt32BE(MAGIC.length + 16);
    const [log2n, r, p] = [head[HEADER - 3], head[HEADER - 2], head[HEADER - 1]];
    if (chunkSize < 1 || chunkSize > 64 * 1024 * 1024 || log2n < 10 || log2n > 20) throw new VaultError('Архів пошкоджено (заголовок).', 'bad_format');
    const key = await deriveKey(password, salt, log2n, r, p);
    let position = HEADER;
    let index = 0;
    while (true) {
      const lengthBuffer = Buffer.alloc(4);
      const read = await handle.read(lengthBuffer, 0, 4, position);
      if (read.bytesRead === 0) throw new VaultError('Архів обрізано: немає завершального шматка.', 'truncated');
      if (read.bytesRead < 4) throw new VaultError('Архів пошкоджено.', 'corrupt');
      const raw = lengthBuffer.readUInt32BE(0);
      const final = (raw & FINAL) !== 0;
      const length = raw & ~FINAL;
      if (length > chunkSize) throw new VaultError('Архів пошкоджено (довжина шматка).', 'corrupt');
      const body = Buffer.alloc(length + TAG);
      const got = await handle.read(body, 0, length + TAG, position + 4);
      if (got.bytesRead < length + TAG) throw new VaultError('Архів обрізано.', 'truncated');
      const decipher = createDecipheriv('aes-256-gcm', key, nonceFor(index), { authTagLength: TAG });
      decipher.setAAD(aadFor(head, final));
      decipher.setAuthTag(body.subarray(length));
      let plain;
      try { plain = Buffer.concat([decipher.update(body.subarray(0, length)), decipher.final()]); }
      catch { throw new VaultError(index === 0 ? 'Неправильний пароль або архів пошкоджено.' : 'Архів пошкоджено: не збігається перевірка цілісності.', index === 0 ? 'bad_password' : 'corrupt'); }
      position += 4 + length + TAG;
      index += 1;
      onBytes?.(plain.length);
      yield plain;
      if (final) {
        const extra = await handle.read(Buffer.alloc(1), 0, 1, position);
        if (extra.bytesRead) throw new VaultError('Архів пошкоджено: зайві дані після завершення.', 'corrupt');
        return;
      }
    }
  } finally {
    await handle.close();
  }
}

/** Повний прохід без запису: пароль і всі теги перевіряються до розпакування. Повертає розмір відкритого тексту. */
export async function verifyFile(path, password, { onBytes } = {}) {
  let total = 0;
  for await (const piece of decryptFile(path, password, { onBytes })) total += piece.length;
  return total;
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const piece of createReadStream(path)) hash.update(piece);
  return hash.digest('hex');
}
