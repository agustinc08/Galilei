import { inflateRawSync } from 'node:zlib';
import { DocumentExtractionError } from './document-extraction-errors';

export const MAX_ARCHIVE_ENTRIES = 2000;
export const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_EXPANSION_RATIO = 200;
export const MAX_ARCHIVE_INPUT_BYTES = 20 * 1024 * 1024;

export type SafeZipArchive = {
  entries: Map<string, Buffer>;
  names: string[];
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;

export class SafeZipError extends DocumentExtractionError {
  constructor(code: string) {
    super('The Office archive failed safe validation.', code);
    this.name = 'SafeZipError';
  }
}

export function readSafeZipArchive(input: Buffer): SafeZipArchive {
  if (
    input.length < 22 ||
    input.length > MAX_ARCHIVE_INPUT_BYTES ||
    input.readUInt32LE(0) !== LOCAL_SIGNATURE
  ) {
    throw new SafeZipError('INVALID_ARCHIVE');
  }

  const eocdOffset = findEndOfCentralDirectory(input);
  if (eocdOffset < 0) throw new SafeZipError('INVALID_ARCHIVE');

  const diskNumber = input.readUInt16LE(eocdOffset + 4);
  const centralDisk = input.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = input.readUInt16LE(eocdOffset + 8);
  const entryCount = input.readUInt16LE(eocdOffset + 10);
  const centralSize = input.readUInt32LE(eocdOffset + 12);
  const centralOffset = input.readUInt32LE(eocdOffset + 16);
  const commentLength = input.readUInt16LE(eocdOffset + 20);

  if (
    eocdOffset + 22 + commentLength !== input.length ||
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralSize > MAX_CENTRAL_DIRECTORY_BYTES ||
    centralOffset + centralSize !== eocdOffset ||
    entryCount < 1 ||
    entryCount > MAX_ARCHIVE_ENTRIES
  ) {
    throw new SafeZipError('ARCHIVE_LIMIT_EXCEEDED');
  }

  const names: string[] = [];
  const entries = new Map<string, Buffer>();
  const seen = new Set<string>();
  const localRanges: Array<{ start: number; end: number }> = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > eocdOffset ||
      input.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
    ) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }

    const flags = input.readUInt16LE(cursor + 8);
    const method = input.readUInt16LE(cursor + 10);
    const expectedCrc = input.readUInt32LE(cursor + 16);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const uncompressedSize = input.readUInt32LE(cursor + 24);
    const nameLength = input.readUInt16LE(cursor + 28);
    const extraLength = input.readUInt16LE(cursor + 30);
    const fileCommentLength = input.readUInt16LE(cursor + 32);
    const startDisk = input.readUInt16LE(cursor + 34);
    const localOffset = input.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + fileCommentLength;

    if (
      next > eocdOffset ||
      nameLength < 1 ||
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
    validateExtraFields(
      input.subarray(
        cursor + 46 + nameLength,
        cursor + 46 + nameLength + extraLength,
      ),
    );

    const rawName = decodeUtf8(
      input.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    const name = normalizeArchiveName(rawName);
    const lowerName = name.toLocaleLowerCase('en-US');
    if (seen.has(lowerName)) throw new SafeZipError('DUPLICATE_ARCHIVE_ENTRY');
    seen.add(lowerName);
    names.push(name);

    if (flags & 0x41) throw new SafeZipError('ENCRYPTED_UNSUPPORTED');
    if (method !== 0 && method !== 8)
      throw new SafeZipError('UNSUPPORTED_COMPRESSION');
    if (uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new SafeZipError('ARCHIVE_LIMIT_EXCEEDED');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new SafeZipError('ARCHIVE_LIMIT_EXCEEDED');
    }
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 ||
        uncompressedSize / compressedSize > MAX_ARCHIVE_EXPANSION_RATIO)
    ) {
      throw new SafeZipError('ARCHIVE_EXPANSION_LIMIT');
    }

    if (
      localOffset + 30 > centralOffset ||
      input.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
    ) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
    const localFlags = input.readUInt16LE(localOffset + 6);
    const localMethod = input.readUInt16LE(localOffset + 8);
    const localNameLength = input.readUInt16LE(localOffset + 26);
    const localExtraLength = input.readUInt16LE(localOffset + 28);
    if (
      localOffset + 30 + localNameLength + localExtraLength + compressedSize >
      centralOffset
    ) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
    validateExtraFields(
      input.subarray(
        localOffset + 30 + localNameLength,
        localOffset + 30 + localNameLength + localExtraLength,
      ),
    );
    const localName = decodeUtf8(
      input.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    );
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localName !== rawName
    ) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    localRanges.push({ start: localOffset, end: dataStart + compressedSize });
    const compressed = input.subarray(dataStart, dataStart + compressedSize);
    let output: Buffer;
    try {
      output =
        method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, {
              maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES,
            });
    } catch {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
    if (output.length !== uncompressedSize || crc32(output) !== expectedCrc) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
    entries.set(name, output);
    cursor = next;
  }

  if (cursor !== centralOffset + centralSize) {
    throw new SafeZipError('INVALID_ARCHIVE');
  }
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      throw new SafeZipError('INVALID_ARCHIVE');
    }
  }
  return { entries, names };
}

function validateExtraFields(extra: Buffer) {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw new SafeZipError('INVALID_ARCHIVE');
    const identifier = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    if (offset + 4 + length > extra.length || identifier === 0x0001) {
      throw new SafeZipError(
        identifier === 0x0001 ? 'UNSUPPORTED_ZIP64' : 'INVALID_ARCHIVE',
      );
    }
    offset += 4 + length;
  }
}

function findEndOfCentralDirectory(input: Buffer) {
  const first = Math.max(0, input.length - 22 - 0xffff);
  for (let offset = input.length - 22; offset >= first; offset -= 1) {
    if (input.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function normalizeArchiveName(value: string) {
  const name = value.replace(/\\/gu, '/');
  const parts = name.split('/');
  const effectiveParts = name.endsWith('/') ? parts.slice(0, -1) : parts;
  if (
    !name ||
    name.startsWith('/') ||
    /^[A-Za-z]:/u.test(name) ||
    name.includes('\0') ||
    effectiveParts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new SafeZipError('ARCHIVE_PATH_TRAVERSAL');
  }
  return name;
}

function decodeUtf8(value: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new SafeZipError('INVALID_ARCHIVE');
  }
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
