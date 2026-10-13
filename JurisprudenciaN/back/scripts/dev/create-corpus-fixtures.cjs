const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, 'fixtures/corpus');
fs.mkdirSync(path.join(output, 'version-a'), { recursive: true });
fs.mkdirSync(path.join(output, 'version-b'), { recursive: true });

function makePdf(pages) {
  const objects = [];
  const pageIds = pages.map((_, index) => 3 + index * 2);
  const fontId = 3 + pages.length * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((text, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const escaped = text.replace(/([\\()])/g, '\\$1');
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : '';
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

const multipage = makePdf(['FALLO FICTICIO - primera pagina.', 'JORGE PORCEL FIXTURE aparece en la pagina dos. Criterio civil sintetico.']);
fs.writeFileSync(path.join(output, 'fallo-fixture.pdf'), multipage);
fs.writeFileSync(path.join(output, 'copia-con-otro-nombre.pdf'), multipage);
fs.writeFileSync(path.join(output, 'pagina-vacia.pdf'), makePdf(['']));
fs.writeFileSync(path.join(output, 'version-a', 'mismo-nombre.pdf'), makePdf(['Contenido sintetico version A.']));
fs.writeFileSync(path.join(output, 'version-b', 'mismo-nombre.pdf'), makePdf(['Contenido sintetico version B.']));
fs.writeFileSync(path.join(output, 'nota-fixture.txt'), 'Documento de texto plano de fixture civil.');
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  synthetic: true,
  confidential: false,
  files: [
    'fallo-fixture.pdf', 'copia-con-otro-nombre.pdf', 'pagina-vacia.pdf',
    'version-a/mismo-nombre.pdf', 'version-b/mismo-nombre.pdf', 'nota-fixture.txt',
  ],
}, null, 2));
console.log(`CORPUS_FIXTURE=PASS; directory=${output}; files=6`);
