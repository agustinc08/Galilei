'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { pdfBuffer } = require('./fixtures.cjs');

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
  }
  return current >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const directoryParts = [];
  let localOffset = 0;

  for (const [filename, rawContent] of entries) {
    const name = Buffer.from(filename, 'utf8');
    const content = Buffer.from(rawContent, 'utf8');
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(localOffset, 42);
    directoryParts.push(directory, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const directoryStart = localOffset;
  const directorySize = directoryParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...directoryParts, end]);
}

function ensureFolderUploadFixture(reportDirectory) {
  const root = path.join(reportDirectory, 'fixture');
  const selectedDirectory = path.join(root, 'Lote legal');
  const nestedDirectory = path.join(selectedDirectory, 'Contratos ñ 2026');
  fs.mkdirSync(nestedDirectory, { recursive: true });
  fs.writeFileSync(path.join(nestedDirectory, 'accion.pdf'), pdfBuffer);
  fs.writeFileSync(path.join(nestedDirectory, 'contrato.doc'), Buffer.from('Synthetic Word DOC UI fixture'));
  fs.writeFileSync(path.join(nestedDirectory, 'Acción reparadora por daño emergente con documentación complementaria y anexos.pdf'), pdfBuffer);
  fs.writeFileSync(path.join(nestedDirectory, 'informe.docx'), zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento sintético de carpeta</w:t></w:r></w:p></w:body></w:document>'],
  ]));
  fs.writeFileSync(path.join(nestedDirectory, 'ilegible.pdf'), Buffer.from('not a PDF signature'));
  fs.writeFileSync(path.join(nestedDirectory, 'foto.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/1sAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(path.join(nestedDirectory, '~$temporal.docx'), Buffer.from('Office temporary file'));
  fs.writeFileSync(path.join(selectedDirectory, 'comprimido.zip'), zip([
    ['documento.txt', 'Archivo comprimido no admitido'],
  ]));
  return selectedDirectory;
}

module.exports = { ensureFolderUploadFixture, zip };
