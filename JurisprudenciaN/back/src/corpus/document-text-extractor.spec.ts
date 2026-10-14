import { deflateRawSync } from 'node:zlib';
import {
  BasicDocumentTextExtractor,
  EncryptedDocumentError,
  InvalidPdfError,
} from './document-text-extractor';
import { DocumentFormatDetector } from './document-format-detector';
import { readSafeZipArchive, SafeZipError } from './safe-zip';

type ZipEntry = {
  name: string;
  text: string;
  stored?: boolean;
  encrypted?: boolean;
};

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.text, 'utf8');
    const method = entry.stored ? 0 : 8;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const flags = entry.encrypted ? 1 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function makeDocx(extra: ZipEntry[] = []) {
  return makeZip([
    {
      name: '[Content_Types].xml',
      text: '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: 'word/document.xml',
      text: '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Expediente CIV 12345/2026</w:t></w:r></w:p><w:p><w:r><w:t>La responsabilidad civil y el daño moral</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    },
    ...extra,
  ]);
}

function makeOdt() {
  return makeZip([
    {
      name: 'mimetype',
      text: 'application/vnd.oasis.opendocument.text',
      stored: true,
    },
    {
      name: 'content.xml',
      text: '<office:document-content xmlns:office="urn:office" xmlns:text="urn:text" xmlns:table="urn:table"><office:body><office:text><text:h>Expediente CIV 12345/2026</text:h><text:p>La responsabilidad civil y el daño moral</text:p><table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>',
    },
  ]);
}

describe('BasicDocumentTextExtractor multiformat safety', () => {
  const extractor = new BasicDocumentTextExtractor();
  const detector = new DocumentFormatDetector();

  it('detects PDF by signature even when submitted MIME is spoofed', async () => {
    const content = Buffer.from('%PDF-not-a-complete-pdf');
    expect(detector.detect('misleading.txt', content).format).toBe('PDF');
    await expect(
      extractor.extract('misleading.txt', 'text/plain', content),
    ).rejects.toBeInstanceOf(InvalidPdfError);
  });

  it('decodes UTF-8 BOM and UTF-16 TXT as a virtual text page', async () => {
    const utf8 = await extractor.extract(
      'fixture.txt',
      'application/pdf',
      Buffer.from('\ufeffAcción, cámara, daño y señor.', 'utf8'),
    );
    expect(utf8.mimeDetected).toBe('text/plain');
    expect(utf8.text).toBe('Acción, cámara, daño y señor.');
    expect(utf8.pages).toEqual([{ pageNumber: 1, text: utf8.text }]);

    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('UTF-16: jurisdicción', 'utf16le'),
    ]);
    expect((await extractor.extract('fixture.txt', '', utf16)).text).toBe(
      'UTF-16: jurisdicción',
    );
  });

  it('rejects undecodable TXT rather than silently replacing characters', async () => {
    await expect(
      extractor.extract(
        'fixture.txt',
        'text/plain',
        Buffer.from([0xff, 0xfe, 0x41]),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });

  it('extracts RTF paragraphs, escaped bytes and Unicode without running objects', async () => {
    const rtf = Buffer.from(
      "{\\rtf1\\ansi Texto \\b visible\\b0.\\par Acci\\u243?n y se\\u241?or. caf\\'e9.\\tab fin.}",
      'ascii',
    );
    const result = await extractor.extract(
      'fixture.rtf',
      'application/pdf',
      rtf,
    );
    expect(result.formatDetected).toBe('RTF');
    expect(result.text).toContain('Texto visible.');
    expect(result.text).toContain('Acción y señor.');
    expect(result.text).toContain('fin.');
    expect(result.pages[0].pageNumber).toBe(1);
  });

  it('extracts DOCX text and table cells while ignoring external relationship targets', async () => {
    const content = makeDocx([
      {
        name: 'word/_rels/document.xml.rels',
        text: '<Relationships><Relationship Target="https://example.invalid/evil" TargetMode="External"/></Relationships>',
      },
    ]);
    const result = await extractor.extract(
      'fixture.docx',
      'application/pdf',
      content,
    );
    expect(result.formatDetected).toBe('DOCX');
    expect(result.mimeDetected).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.text).toContain('Expediente CIV 12345/2026');
    expect(result.text).toContain('responsabilidad civil y el daño moral');
    expect(result.text).toContain('A\tB');
    expect(result.text).not.toContain('example.invalid');
    expect(result.pages).toHaveLength(1);
  });

  it('extracts ODT paragraphs, headings and table cells', async () => {
    const result = await extractor.extract('fixture.odt', '', makeOdt());
    expect(result.formatDetected).toBe('ODT');
    expect(result.text).toContain('Expediente CIV 12345/2026');
    expect(result.text).toContain('responsabilidad civil y el daño moral');
    expect(result.text).toContain('A\tB');
  });

  it('rejects fake Office containers, macro documents and encrypted archives', async () => {
    await expect(
      extractor.extract(
        'fake.docx',
        '',
        makeZip([{ name: 'random.txt', text: 'not Office' }]),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ARCHIVE' });
    await expect(
      extractor.extract('macro.docm', '', Buffer.from('not a document')),
    ).rejects.toMatchObject({ code: 'MACRO_DOCUMENT' });
    expect(() =>
      readSafeZipArchive(
        makeZip([{ name: 'word/document.xml', text: 'data', encrypted: true }]),
      ),
    ).toThrow(SafeZipError);
  });

  it('rejects archive path traversal and high expansion ratios before extraction', () => {
    expect(() =>
      readSafeZipArchive(makeZip([{ name: '../outside.txt', text: 'unsafe' }])),
    ).toThrow();
    expect(() =>
      readSafeZipArchive(
        makeZip([{ name: 'word/document.xml', text: 'x'.repeat(10000) }]),
      ),
    ).toThrow();
  });

  it('rejects XML DTD/entity declarations and keeps extracted markup as text', async () => {
    const externalEntity = makeZip([
      {
        name: '[Content_Types].xml',
        text: '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      {
        name: 'word/document.xml',
        text: '<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///secret">]><w:document><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    await expect(
      extractor.extract('entity.docx', '', externalEntity),
    ).rejects.toMatchObject({ code: 'INVALID_OFFICE_XML' });

    const xss = Buffer.from('{\\rtf1 <script>alert(1)</script>}', 'ascii');
    expect((await extractor.extract('untrusted.rtf', '', xss)).text).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('identifies OLE legacy DOC but does not claim extraction without a safe parser', async () => {
    const doc = Buffer.from('d0cf11e0a1b11ae1', 'hex');
    expect(detector.detect('legacy.doc', doc).format).toBe('DOC');
    await expect(
      extractor.extract('legacy.doc', '', doc),
    ).rejects.toMatchObject({ code: 'LEGACY_DOC_UNSUPPORTED' });
  });

  it('classifies an encrypted modern Office container without trying to open it', () => {
    const encrypted = Buffer.from('d0cf11e0a1b11ae1', 'hex');
    expect(() => detector.detect('locked.docx', encrypted)).toThrow(
      EncryptedDocumentError,
    );
  });
});
