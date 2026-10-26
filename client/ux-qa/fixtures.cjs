'use strict';

const now = '2026-10-16T12:00:00.000Z';

const pdfText = 'BT /F1 18 Tf 54 750 Td (UX QA synthetic sample: responsabilidad civil) Tj ET';
const pdfObjects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(pdfText)} >>\nstream\n${pdfText}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
pdfObjects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xrefOffset = Buffer.byteLength(pdf);
pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
const pdfBuffer = Buffer.from(pdf, 'ascii');

const ficha = {
  sentencia: {
    id: 901, slugPublico: 'ux-qa-001', numeroSentencia: 'QA-001', tipoFallo: 'Sentencia definitiva',
    sala: 'I', fecha: '2024-10-01T00:00:00.000Z', expediente: '12345/2024',
    tribunalOrigen: 'Cámara Civil', caratula: 'Pérez c/ Gutiérrez s/ daños', actor: 'Pérez',
    demandado: 'Gutiérrez', objeto: 'Daños y perjuicios', magistrados: 'Jueza de muestra',
    publicado: true, activo: true, destacada: false, tienePdf: true,
    createdAt: now, updatedAt: now, resenaPublicada: true,
  },
  resumen: { texto: 'Resumen sintético para QA visual.', fuente: 'Fixture QA', publicado: true },
  resena: 'Contenido de muestra para revisión visual. No representa un fallo real.',
  cita: {
    citaBreve: 'CNCiv., Sala I, 01/10/2024, QA-001',
    citaCompleta: 'Cámara Civil, Sala I, caso sintético QA-001.',
    citaCopiable: 'CNCiv., Sala I, 01/10/2024, QA-001',
  },
  sumarios: [{
    id: 1, numeroSumario: 'QA-S-001', tema: 'Responsabilidad civil',
    texto: 'Texto sintético para validar lectura y panel lateral dentro del Viewer.',
    publicado: true, activo: true, sentenciaId: 901, createdAt: now, updatedAt: now,
  }],
  citasFallo: [], referenciasNormativas: [], referenciasJurisprudenciales: [], referenciasDoctrinarias: [],
  archivosPdf: [{
    id: 71, nombreArchivo: 'ux-qa-001.pdf', nombreOriginal: 'Documento de muestra.pdf',
    rutaArchivo: '/mock/ux-qa-001.pdf', mimeType: 'application/pdf',
    tamanioBytes: pdfBuffer.length, sentenciaId: 901, createdAt: now, updatedAt: now,
  }],
  generatedAt: now,
};

const publicSentencia = {
  ...ficha.sentencia,
  resumen: ficha.resumen.texto,
  resena: ficha.resena,
  cita: ficha.cita,
  sumarios: ficha.sumarios,
  archivosPdf: ficha.archivosPdf,
};

function makeResult(id, page) {
  const suffix = `${page}${id}`;
  return {
    id, sentenciaId: 901, slugPublico: 'ux-qa-001', numeroSumario: `QA-S-${suffix}`,
    numeroSentencia: `QA-${suffix}`, fecha: ficha.sentencia.fecha, sala: 'I',
    magistrados: 'Jueza de muestra', tipoFallo: 'Sentencia definitiva',
    expediente: `12345/${suffix}`, tribunalOrigen: 'Cámara Civil',
    caratula: id === 1 && page === 1
      ? 'Pérez c/ Gutiérrez s/ daños — caso sintético para revisar wrapping de títulos y acciones en distintos anchos'
      : 'Pérez c/ Gutiérrez s/ daños',
    actor: 'Pérez', demandado: 'Gutiérrez', tema: 'Responsabilidad civil',
    textoSumario: `Texto sintético de la página ${page}, resultado ${id}; no valida semántica de búsqueda.`,
    highlights: [{ campo: 'Sumario', texto: 'Contenido <mark>responsabilidad civil</mark> sintético.' }],
    tienePdf: true, pdfDisponible: true, archivoPdfId: 71,
    pdfUrl: '/public/sentencias/ux-qa-001/pdf', score: 1,
    criterioPrincipal: 'Fixture visual', matchedFields: ['sumario'],
  };
}

const pages = [
  [makeResult(1, 1), makeResult(2, 1)],
  [makeResult(3, 2), makeResult(4, 2)],
];

function json(status, payload) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) };
}

function fixtureForRequest(request) {
  const url = new URL(request.url());
  const pathname = url.pathname.replace(/^\/api(?=\/|$)/u, '');
  const method = request.method();

  if (method === 'GET' && pathname === '/public/busqueda/temas') return json(200, { data: ['Responsabilidad civil', 'Daños y perjuicios'] });
  if (method === 'GET' && pathname === '/public/busqueda/interpretacion') return json(200, { data: { summary: 'Búsqueda literal de muestra.', notes: 'El texto de la consulta no modifica el documento.' } });
  if (method === 'GET' && pathname === '/public/sentencias/recientes') return json(200, { data: [] });
  if (method === 'GET' && pathname === '/public/sentencias/mas-recientes') return json(200, { data: [] });
  if (method === 'GET' && pathname === '/catalogos/salas') return json(200, { data: [{ id: 1, nombre: 'I' }, { id: 2, nombre: 'Sala A' }] });
  if (method === 'GET' && pathname === '/catalogos/tipos-fallo') return json(200, { data: [{ id: 1, nombre: 'Sentencia definitiva' }] });
  if (method === 'GET' && pathname === '/catalogos/tribunales-origen') return json(200, { data: [{ id: 1, nombre: 'Cámara Civil' }] });
  if (method === 'GET' && pathname === '/public/busqueda/sugerencias') return json(200, { data: [{ value: 'responsabilidad civil', tipo: 'tema', total: 4 }] });
  if (method === 'GET' && pathname === '/public/busqueda') {
    const query = url.searchParams.get('q') || '';
    if (query === 'UX_QA_SERVICE_UNAVAILABLE') {
      return json(503, { message: 'OpenSearchException: internal fixture diagnostic' });
    }
    if (query === 'UX_QA_NO_RESULTS') {
      return json(200, {
        data: [],
        meta: { total: 0, page: 1, pageSize: 2, pageCount: 0, totalExact: true, hasMore: false, sortUsed: 'fixture', tiempoMs: 1 },
      });
    }
    const page = Math.min(2, Math.max(1, Number(url.searchParams.get('page') || 1)));
    return json(200, {
      data: pages[page - 1],
      meta: { total: 4, page, pageSize: 2, pageCount: 2, totalExact: true, hasMore: page < 2, sortUsed: 'fixture', tiempoMs: 1 },
    });
  }
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001') return json(200, { data: publicSentencia });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/documento') return json(200, { data: ficha });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/cita') {
    if (url.searchParams.has('passage')) return json(400, { message: 'Passages must stay local.' });
    const page = Number(url.searchParams.get('page'));
    return json(200, { data: { citaConPagina: `Cámara Civil, Sala I, p. ${page}` } });
  }
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/relacionados') return json(200, { data: [] });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/relaciones-verificadas') return json(200, { data: [] });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/mismo-expediente') return json(200, { data: [], total: 0, limit: 10, hasMore: false });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/estructura') return json(200, { data: { status: 'NO_STRUCTURE', sections: [] } });
  if (method === 'GET' && pathname === '/public/sentencias/ux-qa-001/pdf') {
    return { status: 200, contentType: 'application/pdf', body: pdfBuffer };
  }
  if (method === 'POST' && /^\/(?:public\/)?estadisticas\/eventos(?:\/share-link)?$/u.test(pathname)) return json(201, { ok: true });
  if (method === 'POST' && /^\/public\/eventos(?:\/share-link)?$/u.test(pathname)) return json(201, { ok: true });

  return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ data: [], meta: { total: 0, page: 1, pageSize: 25, pageCount: 1 } }), fallback: true };
}

module.exports = { fixtureForRequest, pdfBuffer, ficha, publicSentencia };
