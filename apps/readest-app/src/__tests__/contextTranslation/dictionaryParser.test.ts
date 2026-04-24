import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import {
  extractFromZip,
  parseIfo,
  parseStarDict,
} from '@/services/contextTranslation/dictionaryParser';

const textEncoder = new TextEncoder();

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function u16le(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

function makeStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = textEncoder.encode(name);
    const checksum = crc32(data);

    const localHeader = concatBytes(
      u32le(0x04034b50),
      u16le(20),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(checksum),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0),
      nameBytes,
      data,
    );
    localParts.push(localHeader);

    const centralHeader = concatBytes(
      u32le(0x02014b50),
      u16le(20),
      u16le(20),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(checksum),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(0),
      u32le(offset),
      nameBytes,
    );
    centralParts.push(centralHeader);
    offset += localHeader.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  const endOfCentralDirectory = concatBytes(
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(entries.length),
    u16le(entries.length),
    u32le(centralDirectory.length),
    u32le(offset),
    u16le(0),
  );

  return concatBytes(...localParts, centralDirectory, endOfCentralDirectory);
}

describe('parseIfo', () => {
  test('extracts bookname and wordcount', () => {
    const buf = textEncoder.encode(
      "StarDict's dict w/ ex.\nversion=2.4.8\nbookname=testdict\nwordcount=123\nsametypesequence=m\n",
    );
    const result = parseIfo(buf);
    expect(result.name).toBe('testdict');
    expect(result.wordcount).toBe(123);
  });

  test('parses BOM-prefixed metadata', () => {
    const buf = concatBytes(
      new Uint8Array([0xef, 0xbb, 0xbf]),
      textEncoder.encode('bookname=testdict\nwordcount=7\n'),
    );
    const result = parseIfo(buf);
    expect(result.name).toBe('testdict');
    expect(result.wordcount).toBe(7);
  });

  test('throws if bookname missing', () => {
    const buf = textEncoder.encode('version=2.4.8\nwordcount=10\n');
    expect(() => parseIfo(buf)).toThrow();
  });
});

describe('parseStarDict', () => {
  test('parses idx entries and slices dict buffer', () => {
    // Build a minimal .idx: headword "hello\0" + offset=0 + size=5
    const idx = new Uint8Array([104, 101, 108, 108, 111, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    // dict: "world"
    const dict = textEncoder.encode('world');
    const result = parseStarDict({ ifo: new Uint8Array(), idx, dict });
    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('hello');
    expect(result[0]!.definition).toBe('world');
  });

  test('rejects high-bit offsets and sizes outside the dict buffer', () => {
    const idx = new Uint8Array([
      104,
      105,
      0, // "hi\0"
      0x80,
      0x00,
      0x00,
      0x00, // offset = 0x80000000
      0x80,
      0x00,
      0x00,
      0x01, // size = 0x80000001
    ]);
    const dict = textEncoder.encode('abc');
    expect(() => parseStarDict({ ifo: new Uint8Array(), idx, dict })).toThrow(/out of bounds/i);
  });

  test('decompresses .dict.dz archives before parsing entries', async () => {
    const ifo = textEncoder.encode('bookname=testdict\nwordcount=1\n');
    const idx = new Uint8Array([104, 101, 108, 108, 111, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    const dict = textEncoder.encode('world');
    const zip = makeStoredZip([
      { name: 'testdict.ifo', data: ifo },
      { name: 'testdict.idx', data: idx },
      { name: 'testdict.dict.dz', data: gzipSync(dict) },
    ]);

    const { ifo: extractedIfo, idx: extractedIdx, dict: extractedDict } = await extractFromZip(zip);
    const result = parseStarDict({ ifo: extractedIfo, idx: extractedIdx, dict: extractedDict });
    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('hello');
    expect(result[0]!.definition).toBe('world');
  });

  test('strips HTML from definition when sametypesequence starts with h', () => {
    const ifo = textEncoder.encode('bookname=x\nwordcount=1\nsametypesequence=h\n');
    const idx = new Uint8Array([120, 0, 0, 0, 0, 0, 0, 0, 0, 11]);
    const dict = textEncoder.encode('<b>bold</b>');
    const result = parseStarDict({ ifo, idx, dict });
    expect(result[0]!.definition).toBe('bold');
  });

  test('throws if no recognized type in sametypesequence', () => {
    const ifo = textEncoder.encode('bookname=x\nwordcount=1\nsametypesequence=x\n');
    const idx = new Uint8Array([120, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    const dict = textEncoder.encode('hello');
    expect(() => parseStarDict({ ifo, idx, dict })).toThrow();
  });
});
