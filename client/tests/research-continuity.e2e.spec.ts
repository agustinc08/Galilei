import { expect, test, type Page, type Route } from '@playwright/test';
import {
  canonicalPublicSearchPath,
  publicSearchPathFromSaved,
  publicSearchStateFromUrl,
} from '../src/lib/research-continuity';

const DEMO_RESULT = {
  id: 77,
  sentenciaId: 77,
  slugPublico: 'fallo-demo-ninez',
  numeroSumario: '9001',
  numeroSentencia: '12/2024',
  fecha: '2024-06-03T12:00:00.000Z',
  sala: 'C',
  magistrados: 'Dra. Núñez',
  tipoFallo: 'Sentencia',
  expediente: 'CIV 10/2024',
  caratula: 'María Núñez c/ Peña',
  actor: 'María Núñez',
  demandado: 'Peña',
  tema: 'Responsabilidad civil',
  textoSumario: 'Daño y responsabilidad civil en un caso de prueba.',
  esFalloCorpus: false,
  highlights: [],
  tienePdf: false,
  pdfDisponible: false,
  archivoPdfId: null,
  score: 1,
  criterioPrincipal: null,
  matchInfo: {},
  matchedFields: [],
};

const ADMIN = {
  id: 7,
  nombre: 'QA',
  apellido: 'Sintético',
  email: 'research-qa@example.invalid',
  activo: true,
  rol: { id: 1, nombre: 'ADMIN' },
};

type MockCollection = { id: number; nombre: string; itemCount: number; updatedAt: string };
type MockCollectionItem = { id: number; nota: string | null; sentencia: { id: number; slugPublico: string; caratula: string; numeroSentencia: string; expediente: string; sala: string; fecha: string; tipoFallo: string } };
type MockCitationCandidate = {
  id: number;
  sourceSentenceId: number;
  targetSentenceId: number | null;
  rawCitation: string;
  normalizedIdentifier: string;
  identifierType: string;
  status: string;
  extractionMethod: string;
  page: number | null;
  sourceSentence: { id: number; slugPublico: string; caratula: string; expediente: string; sala: string; fecha: string };
  targetSentence: { id: number; slugPublico: string; caratula: string; expediente: string; sala: string; fecha: string } | null;
};

function makePublicSentence() {
  return {
    id: 77,
    slugPublico: DEMO_RESULT.slugPublico,
    numeroSentencia: DEMO_RESULT.numeroSentencia,
    sala: DEMO_RESULT.sala,
    fecha: DEMO_RESULT.fecha,
    expediente: DEMO_RESULT.expediente,
    caratula: DEMO_RESULT.caratula,
    actor: DEMO_RESULT.actor,
    demandado: DEMO_RESULT.demandado,
    cita: {
      citaBreve: 'María Núñez c/ Peña, Sala C, 3/6/2024',
      citaCompleta: 'María Núñez c/ Peña, Sala C, 3/6/2024, Expte. CIV 10/2024, Sentencia 12/2024',
      citaCopiable: 'María Núñez c/ Peña, Sala C, 3/6/2024, Expte. CIV 10/2024, Sentencia 12/2024',
    },
    archivosPdf: [],
    sumarios: [{ id: 9001, tema: 'Responsabilidad civil', texto: DEMO_RESULT.textoSumario }],
  };
}

function makePublicDocument() {
  return {
    sentencia: {
      id: 77,
      slugPublico: DEMO_RESULT.slugPublico,
      numeroSentencia: DEMO_RESULT.numeroSentencia,
      tipoFallo: DEMO_RESULT.tipoFallo,
      sala: DEMO_RESULT.sala,
      fecha: DEMO_RESULT.fecha,
      expediente: DEMO_RESULT.expediente,
      tribunalOrigen: 'Cámara Nacional de Apelaciones en lo Civil',
      actor: DEMO_RESULT.actor,
      demandado: DEMO_RESULT.demandado,
      caratula: DEMO_RESULT.caratula,
      magistrados: DEMO_RESULT.magistrados,
      anonimizado: true,
    },
    cita: makePublicSentence().cita,
    sumarios: [],
    citasFallo: [],
    referenciasNormativas: [],
    referenciasJurisprudenciales: [],
    referenciasDoctrinarias: [],
    resumen: null,
    resena: null,
    archivosPdf: [{ id: 77, nombreArchivo: 'fallo-demo.pdf', nombreOriginal: 'fallo-demo.pdf', mimeType: 'application/pdf' }],
  };
}

function makePdfFixture(pageTexts: string[]) {
  const pageCount = Math.max(1, pageTexts.length);
  const escapePdfText = (text: string) => text
    .replace(/\\/gu, '\\\\')
    .replace(/\(/gu, '\\(')
    .replace(/\)/gu, '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => {
      const contentId = pageCount + 4 + index;
      const fontId = pageCount + 3;
      return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...Array.from({ length: pageCount }, (_, index) => {
      const escaped = escapePdfText(pageTexts[index] ?? '');
      const stream = escaped ? `BT /F1 18 Tf 72 700 Td (${escaped}) Tj ET` : '';
      return `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let pdf = '%PDF-1.4\n%research-continuity local PDF fixture\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function installApiMocks(page: Page, authenticated = false, roleName = ADMIN.rol.nombre) {
  const authenticatedUser = { ...ADMIN, rol: { ...ADMIN.rol, nombre: roleName } };
  const favorites = new Set<number>();
  const saved: Array<Record<string, unknown>> = [];
  const collections: MockCollection[] = [];
  const collectionItems = new Map<number, MockCollectionItem[]>();
  const citationCandidates: MockCitationCandidate[] = [];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  if (authenticated) {
    await page.addInitScript((user) => {
      localStorage.setItem('jurisprudencia_token', 'synthetic-e2e-token');
      localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as Window & { __researchClipboard?: string }).__researchClipboard = text;
          },
        },
      });
    }, authenticatedUser);
  } else {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as Window & { __researchClipboard?: string }).__researchClipboard = text;
          },
        },
      });
    });
  }

  await page.route('**/public/busqueda/sugerencias*', async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/u, '');
    const method = request.method();
    let body: unknown;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    calls.push({ method, path, body });

    if (path === '/auth/me' && method === 'GET') return route.fulfill({ json: authenticatedUser });
    if (path === '/public/busqueda' && method === 'GET') {
      return route.fulfill({ json: {
        data: [DEMO_RESULT],
        meta: {
          total: 1,
          page: Number(url.searchParams.get('page') ?? '1'),
          pageSize: Number(url.searchParams.get('pageSize') ?? '25'),
          pageCount: 1,
          facets: {
            salas: [{ value: 'Sala H', count: 8 }],
            years: [{ value: 2024, count: 7 }],
          },
        },
      } });
    }
    if (path === '/public/busqueda/interpretacion' && method === 'GET') {
      return route.fulfill({ json: { data: { summary: 'La consulta busca desde el inicio de cada palabra.', notes: 'Las tildes se toleran; ñ se mantiene distinta de n.' } } });
    }
    if (path === '/public/busqueda/temas') return route.fulfill({ json: { data: [] } });
    if (path === '/public/sentencias/recientes') {
      return route.fulfill({ json: { data: [{ id: 78, slugPublico: 'incorporado-recientemente', caratula: 'Fallo incorporado recientemente', expediente: 'CIV 1/2011', sala: 'B', fecha: '2011-02-01T00:00:00.000Z' }] } });
    }
    if (path === '/public/sentencias/mas-recientes') {
      return route.fulfill({ json: { data: [{ id: 79, slugPublico: 'decision-reciente', caratula: 'Fallo con decisión reciente', expediente: 'CIV 2/2025', sala: 'A', fecha: '2025-06-01T00:00:00.000Z' }] } });
    }
    if (path === '/catalogos/salas') return route.fulfill({ json: { data: [{ id: 1, nombre: 'C', activo: true }] } });
    if (path.startsWith('/catalogos/')) return route.fulfill({ json: { data: [] } });
    if (path === `/public/sentencias/${DEMO_RESULT.slugPublico}` && method === 'GET') {
      return route.fulfill({ json: { data: makePublicSentence() } });
    }
    if (path === `/public/sentencias/${DEMO_RESULT.slugPublico}/documento` && method === 'GET') {
      return route.fulfill({ json: { data: makePublicDocument() } });
    }
    if (path === `/public/sentencias/${DEMO_RESULT.slugPublico}/pdf` && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: makePdfFixture([
        'responsabilidad civil responsabilidad civil',
        'responsabilidad civil',
      ]) });
    }
    if (path === `/public/sentencias/${DEMO_RESULT.slugPublico}/relaciones-verificadas` && method === 'GET') {
      return route.fulfill({ json: { data: [{
        type: 'CITES',
        status: 'VERIFIED',
        rawCitation: 'Expte. CIV 90/2018',
        page: null,
        judgment: { id: 88, slugPublico: 'antecedente-civil', caratula: 'Antecedente civil', numeroSentencia: '20/2018', expediente: 'CIV 90/2018', sala: 'A', fecha: '2018-03-02T00:00:00.000Z' },
      }] } });
    }
    if (path === '/favoritos' && method === 'GET') {
      return route.fulfill({ json: { data: [...favorites].map((sentenciaId) => ({ sentenciaId })) } });
    }
    const favoriteMatch = path.match(/^\/favoritos\/(\d+)$/u);
    if (favoriteMatch && method === 'POST') {
      favorites.add(Number(favoriteMatch[1]));
      return route.fulfill({ status: 201, json: { data: { sentenciaId: Number(favoriteMatch[1]) } } });
    }
    if (favoriteMatch && method === 'DELETE') {
      favorites.delete(Number(favoriteMatch[1]));
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (path === '/busquedas-guardadas' && method === 'GET') {
      return route.fulfill({ json: { data: saved } });
    }
    if (path === '/busquedas-guardadas' && method === 'POST') {
      saved.push({
        id: 1,
        usuarioId: ADMIN.id,
        ...(body as Record<string, unknown>),
        createdAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-25T12:00:00.000Z',
      });
      return route.fulfill({ status: 201, json: { data: saved[saved.length - 1] } });
    }
    if (path === '/research/citation-candidates' && method === 'GET') {
      const pending = citationCandidates.filter((candidate) => candidate.status === 'DETECTED_CANDIDATE');
      return route.fulfill({ json: { data: pending, meta: { total: pending.length, pageSize: 100 } } });
    }
    const extractCitationMatch = path.match(/^\/research\/citation-candidates\/(\d+)\/extract$/u);
    if (extractCitationMatch && method === 'POST') {
      const sourceSentenceId = Number(extractCitationMatch[1]);
      if (!citationCandidates.some((candidate) => candidate.sourceSentenceId === sourceSentenceId)) {
        citationCandidates.push({
          id: citationCandidates.length + 1,
          sourceSentenceId,
          targetSentenceId: 88,
          rawCitation: 'Expte. CIV 90/2018',
          normalizedIdentifier: 'CIV90/2018',
          identifierType: 'EXPEDIENTE',
          status: 'DETECTED_CANDIDATE',
          extractionMethod: 'explicit-case-identifier-v1',
          page: null,
          sourceSentence: { id: sourceSentenceId, slugPublico: DEMO_RESULT.slugPublico, caratula: DEMO_RESULT.caratula, expediente: DEMO_RESULT.expediente, sala: DEMO_RESULT.sala, fecha: DEMO_RESULT.fecha },
          targetSentence: { id: 88, slugPublico: 'antecedente-civil', caratula: 'Antecedente civil', expediente: 'CIV 90/2018', sala: 'A', fecha: '2018-03-02T00:00:00.000Z' },
        });
      }
      return route.fulfill({ status: 201, json: { data: { created: 1 } } });
    }
    const reviewCitationMatch = path.match(/^\/research\/citation-candidates\/(\d+)\/review$/u);
    if (reviewCitationMatch && method === 'PATCH') {
      const candidate = citationCandidates.find((item) => item.id === Number(reviewCitationMatch[1]));
      if (candidate) candidate.status = String((body as Record<string, unknown>).status ?? candidate.status);
      return route.fulfill({ json: { data: candidate } });
    }
    if (path === '/research/collections' && method === 'GET') {
      return route.fulfill({ json: { data: collections } });
    }
    if (path === '/research/collections' && method === 'POST') {
      const collection: MockCollection = {
        id: collections.length + 1,
        nombre: String((body as Record<string, unknown>).nombre ?? ''),
        itemCount: 0,
        updatedAt: '2026-10-25T12:00:00.000Z',
      };
      collections.push(collection);
      collectionItems.set(collection.id, []);
      return route.fulfill({ status: 201, json: { data: collection } });
    }
    const collectionItemsMatch = path.match(/^\/research\/collections\/(\d+)\/items(?:\/(\d+))?(?:\/note)?$/u);
    const collectionMatch = path.match(/^\/research\/collections\/(\d+)$/u);
    if (collectionMatch && method === 'GET') {
      const id = Number(collectionMatch[1]);
      const collection = collections.find((item) => item.id === id);
      if (!collection) return route.fulfill({ status: 404, json: { message: 'not found' } });
      return route.fulfill({ json: { data: { ...collection, items: collectionItems.get(id) ?? [] }, meta: { total: (collectionItems.get(id) ?? []).length, page: 1, pageSize: 25, pageCount: 1 } } });
    }
    if (collectionMatch && method === 'PATCH') {
      const collection = collections.find((item) => item.id === Number(collectionMatch[1]));
      if (!collection) return route.fulfill({ status: 404, json: { message: 'not found' } });
      collection.nombre = String((body as Record<string, unknown>).nombre ?? collection.nombre);
      return route.fulfill({ json: { data: collection } });
    }
    if (collectionMatch && method === 'DELETE') {
      const id = Number(collectionMatch[1]);
      const index = collections.findIndex((item) => item.id === id);
      if (index >= 0) collections.splice(index, 1);
      collectionItems.delete(id);
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (collectionItemsMatch && method === 'POST' && collectionItemsMatch[2]) {
      const id = Number(collectionItemsMatch[1]);
      const items = collectionItems.get(id) ?? [];
      const alreadyAdded = items.some((item) => item.sentencia.id === Number(collectionItemsMatch[2]));
      if (!alreadyAdded) items.push({ id: items.length + 1, nota: null, sentencia: { id: 77, slugPublico: DEMO_RESULT.slugPublico, caratula: DEMO_RESULT.caratula, numeroSentencia: DEMO_RESULT.numeroSentencia, expediente: DEMO_RESULT.expediente, sala: DEMO_RESULT.sala, fecha: DEMO_RESULT.fecha, tipoFallo: DEMO_RESULT.tipoFallo } });
      collectionItems.set(id, items);
      const collection = collections.find((item) => item.id === id);
      if (collection) collection.itemCount = items.length;
      return route.fulfill({ status: 201, json: { data: { added: !alreadyAdded }, added: !alreadyAdded } });
    }
    if (collectionItemsMatch && method === 'PATCH' && collectionItemsMatch[2]) {
      const items = collectionItems.get(Number(collectionItemsMatch[1])) ?? [];
      const item = items.find((entry) => entry.id === Number(collectionItemsMatch[2]));
      if (item) item.nota = String((body as Record<string, unknown>).nota ?? '');
      return route.fulfill({ json: { data: { id: item?.id, nota: item?.nota } } });
    }
    if (collectionItemsMatch && method === 'DELETE' && collectionItemsMatch[2]) {
      const id = Number(collectionItemsMatch[1]);
      const items = collectionItems.get(id) ?? [];
      const itemIndex = items.findIndex((entry) => entry.id === Number(collectionItemsMatch[2]));
      if (itemIndex >= 0) items.splice(itemIndex, 1);
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    return route.fulfill({ status: 404, json: { message: `Unmocked test API: ${method} ${path}` } });
  });

  await page.route('**/api/public/busqueda/sugerencias**', async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  return { calls };
}

test('public search state is canonical and a copied deep link preserves query, filters, sort and page', async ({ page }) => {
  const input = new URLSearchParams('q=responsabilidad%20civil&sala=C&sortBy=fecha&sortOrder=asc&page=3&pageSize=10&operador=AND&unknown=omit');
  expect(canonicalPublicSearchPath(input)).toBe('/consulta?q=responsabilidad+civil&sala=C&sortBy=fecha&sortOrder=asc&page=3&pageSize=10');
  expect(publicSearchStateFromUrl(input)).toMatchObject({ q: 'responsabilidad civil', sala: 'C', page: 3, pageSize: 10 });
  expect(publicSearchPathFromSaved({
    kind: 'consulta-publica', version: 1,
    state: { q: 'responsabilidad civil', sala: 'C', sortBy: 'fecha', sortOrder: 'asc', page: 3, pageSize: 10 },
  })).toContain('page=3');
  expect(publicSearchPathFromSaved({ kind: 'legacy', state: {} })).toBeNull();

  await installApiMocks(page);
  await page.goto('/consulta?q=responsabilidad%20civil&sala=C&sortBy=fecha&sortOrder=asc&page=3&pageSize=10');
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await expect(page.getByRole('button', { name: 'Guardar favorito' })).toHaveCount(0);
  await expect(page.getByLabel('Filtros activos')).toContainText('Sala: Sala C');
  await page.reload();
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await expect(page.getByLabel('Filtros activos')).toContainText('Sala: Sala C');
  await expect(page.getByRole('button', { name: 'Copiar enlace de búsqueda' })).toBeVisible();
  const explanation = page.locator('details').filter({ has: page.getByText('Cómo se interpreta esta búsqueda') });
  await explanation.locator('summary').click();
  await expect(explanation).toContainText('desde el inicio de cada palabra');
  await page.getByRole('button', { name: 'Consejos de búsqueda' }).click();
  await expect(page.getByRole('dialog', { name: 'Ayuda de búsqueda' })).toContainText('se considera distinta de n');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Copiar enlace de búsqueda' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enlace de búsqueda copiado' })).toBeVisible();
  const copied = await page.evaluate(() => (window as Window & { __researchClipboard?: string }).__researchClipboard);
  expect(copied).toContain('/consulta?q=responsabilidad+civil&sala=C');
  expect(copied).toContain('sortBy=fecha');
  expect(copied).toContain('page=3');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('permission denied'); } },
    });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: 'Copiar enlace de búsqueda' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'no permitió copiar' })).toBeVisible();

  await page.getByRole('link', { name: 'Ver sumario', exact: true }).click();
  await expect(page).toHaveURL(/\/consulta\/sentencia\/fallo-demo-ninez/u);
  await expect(page.getByRole('heading', { name: 'María Núñez c/ Peña' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await expect(page.getByLabel('Filtros activos')).toContainText('Sala: Sala C');
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'María Núñez c/ Peña' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await page.getByRole('link', { name: 'Ver sumario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'María Núñez c/ Peña' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a resultados' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/consulta');
  const returnedSearch = new URL(page.url()).searchParams;
  expect(returnedSearch.get('q')).toBe('responsabilidad civil');
  expect(returnedSearch.get('sala')).toBe('C');
  expect(returnedSearch.get('sortBy')).toBe('fecha');
  expect(returnedSearch.get('sortOrder')).toBe('asc');
  expect(returnedSearch.get('page')).toBe('3');
  expect(returnedSearch.get('pageSize')).toBe('10');
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await expect(page.getByLabel('Filtros activos')).toContainText('Sala: Sala C');
});

test('authorized researcher can favorite results, copy an authoritative citation and save/reopen the query', async ({ page }) => {
  const { calls } = await installApiMocks(page, true);
  await page.goto('/consulta?q=da%C3%B1o&tema=Responsabilidad%20civil&sortBy=relevancia&sortOrder=desc&page=2&pageSize=25');
  await expect(page.getByRole('button', { name: 'Guardar favorito' })).toBeVisible();

  await page.getByRole('button', { name: 'Guardar favorito' }).click();
  await expect(page.getByRole('button', { name: 'Quitar favorito' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar favorito' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Quitar favorito' }).click();
  await expect(page.getByRole('button', { name: 'Guardar favorito' })).toBeVisible();
  expect(calls.filter((call) => call.path === '/favoritos/77' && call.method === 'POST')).toHaveLength(1);
  expect(calls.filter((call) => call.path === '/favoritos/77' && call.method === 'DELETE')).toHaveLength(1);

  await page.getByRole('button', { name: 'Guardar favorito' }).click();
  await expect(page.getByRole('button', { name: 'Quitar favorito' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver sumario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'María Núñez c/ Peña' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a resultados' }).click();
  await expect(page.getByRole('button', { name: 'Quitar favorito' })).toBeVisible();
  expect(calls.filter((call) => call.path === '/favoritos/77' && call.method === 'POST')).toHaveLength(2);

  await page.getByRole('button', { name: 'Copiar cita' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cita y enlace de Galilei copiados' })).toBeVisible();
  const citation = await page.evaluate(() => (window as Window & { __researchClipboard?: string }).__researchClipboard);
  expect(citation).toContain('María Núñez c/ Peña, Sala C');
  expect(citation).toContain('Fuente Galilei: http://127.0.0.1:4012/consulta/sentencia/fallo-demo-ninez');

  const saveTrigger = page.getByRole('button', { name: 'Guardar búsqueda', exact: true });
  await saveTrigger.click();
  await expect(page.getByLabel('Nombre de la búsqueda')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Guardar búsqueda pública' })).toHaveCount(0);
  await expect(saveTrigger).toBeFocused();
  await saveTrigger.click();
  await page.getByLabel('Nombre de la búsqueda').fill('Daño civil');
  await page.getByRole('button', { name: 'Guardar búsqueda' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: 'Búsqueda guardada en tu cuenta' })).toBeVisible();
  const saveCall = calls.find((call) => call.path === '/busquedas-guardadas' && call.method === 'POST');
  expect(saveCall?.body).toMatchObject({
    nombre: 'Daño civil',
    queryJson: {
      kind: 'consulta-publica',
      version: 1,
      state: { q: 'daño', tema: 'Responsabilidad civil', page: 2, pageSize: 25 },
    },
  });
  expect(JSON.stringify(saveCall?.body)).not.toContain('results');

  await page.goto('/busquedas-guardadas');
  await expect(page.getByRole('button', { name: 'Ejecutar' })).toBeVisible();
  await page.getByRole('button', { name: 'Ejecutar' }).click();
  await expect(page).toHaveURL(/\/consulta\?q=da%C3%B1o&tema=Responsabilidad\+civil&sortBy=relevancia&sortOrder=desc&page=2&pageSize=25/u);
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('daño');
});

test('public facets preserve the query while separating decision date from recent incorporation', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/consulta?q=responsabilidad%20civil&page=4');
  await expect(page.getByRole('heading', { name: 'Filtrar estos resultados' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sala H (8)' })).toBeVisible();
  await page.getByRole('button', { name: 'Sala H (8)' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sala')).toBe('Sala H');
  await page.getByRole('button', { name: '2024 (7)' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('anio')).toBe('2024');
  expect(new URL(page.url()).searchParams.get('q')).toBe('responsabilidad civil');
  expect(new URL(page.url()).searchParams.get('page')).toBe('1');

  await expect(page.getByText('Fallo con decisión reciente')).toBeHidden();
  await page.getByText('Fallos incorporados recientemente').click();
  await expect(page.getByText('Fallo incorporado recientemente')).toBeVisible();
  await page.getByText('Fallos más recientes por fecha de decisión').click();
  await expect(page.getByText('Fallo con decisión reciente')).toBeVisible();
  await expect(page.getByText('Ordenados por la fecha del fallo, no por la fecha en que se incorporó al sistema.')).toBeVisible();
});

test('public judgment exposes only the verified relationship response', async ({ page }) => {
  await installApiMocks(page);
  await page.goto(`/fallos/${DEMO_RESULT.slugPublico}`);
  const citations = page.getByText('Citas verificadas');
  await expect(citations).toBeVisible();
  await expect(page.getByRole('link', { name: /Este fallo cita a: Antecedente civil/u })).toBeVisible();
  const citationSummary = page.getByText('Relación verificada por revisión editorial');
  await expect(citationSummary).toContainText('Expte. CIV 90/2018');
});

test('collection access does not imply favorite permissions for a reader role', async ({ page }) => {
  const { calls } = await installApiMocks(page, true, 'LECTOR');
  await page.goto(`/fallos/${DEMO_RESULT.slugPublico}`);
  await expect(page.getByRole('button', { name: 'Agregar a colección' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar favorito' })).toHaveCount(0);
  expect(calls.some((call) => call.path === '/favoritos' && call.method === 'GET')).toBe(false);
});

test('citation candidates stay unpublished until a reviewer explicitly verifies them', async ({ page }) => {
  const { calls } = await installApiMocks(page, true);
  await page.goto('/citas-pendientes');
  await page.getByLabel('Detectar citas de un fallo específico').fill('77');
  await page.getByRole('button', { name: 'Detectar candidatas' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 candidatas nuevas' })).toBeVisible();
  await expect(page.getByText('Candidata sin verificar')).toBeVisible();
  await expect(page.getByText('Expte. CIV 90/2018')).toBeVisible();
  await page.getByRole('button', { name: 'Verificar relación' }).click();
  await expect(page.getByText('No hay citas pendientes')).toBeVisible();
  expect(calls.some((call) => call.path === '/research/citation-candidates/77/extract' && call.method === 'POST')).toBe(true);
  expect(calls.some((call) => call.path === '/research/citation-candidates/1/review' && call.method === 'PATCH' && (call.body as { status?: string })?.status === 'VERIFIED')).toBe(true);
});

test('collection and citation research tools fit narrow and desktop viewports', async ({ page }) => {
  await installApiMocks(page, true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/colecciones');
    await expect(page.getByRole('heading', { name: 'Mis colecciones' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/citas-pendientes');
    await expect(page.getByRole('heading', { name: 'Revisión de citas' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('in-document search counts local PDF matches and navigates to the matching page', async ({ page }) => {
  await installApiMocks(page);
  await page.goto(`/consulta/sentencia/${DEMO_RESULT.slugPublico}/documento?q=responsabilidad%20civil`);
  await page.getByRole('button', { name: 'Buscar dentro del fallo' }).click();
  await expect(page.getByLabel('Buscar en este fallo')).toHaveValue('responsabilidad civil');
  const searchButton = page.getByRole('button', { name: 'Buscar', exact: true });
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  const status = page.locator('#pdf-document-search-status');
  await expect(status).toHaveText('1 de 3 · Página 1');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(status).toHaveText('2 de 3 · Página 1');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(status).toHaveText('3 de 3 · Página 2');
  await expect(page.locator('iframe')).toHaveAttribute('src', /page=2/u);
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(status).toHaveText('2 de 3 · Página 1');
  await page.getByRole('button', { name: 'Limpiar' }).click();
  await expect(status).toContainText('La búsqueda se procesa en este dispositivo.');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('fallo-demo.pdf');
});

test('in-document search reports a scanned PDF with no searchable text', async ({ page }) => {
  await installApiMocks(page);
  await page.route(`**/api/public/sentencias/${DEMO_RESULT.slugPublico}/pdf`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: makePdfFixture(['']) });
  });
  await page.goto(`/consulta/sentencia/${DEMO_RESULT.slugPublico}/documento`);
  await page.getByRole('button', { name: 'Buscar dentro del fallo' }).click();
  await expect(page.getByText('No hay texto disponible para buscar dentro de este PDF.')).toBeVisible();
});

test('in-document search extracts a 50-page PDF once and jumps to the matching page', async ({ page }) => {
  await installApiMocks(page);
  const pages = Array.from({ length: 50 }, (_, index) => index === 49
    ? 'responsabilidad civil en la última página'
    : `Contenido jurídico sintético de la página ${index + 1}`);
  await page.route(`**/api/public/sentencias/${DEMO_RESULT.slugPublico}/pdf`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: makePdfFixture(pages) });
  });
  await page.goto(`/consulta/sentencia/${DEMO_RESULT.slugPublico}/documento`);
  await page.getByRole('button', { name: 'Buscar dentro del fallo' }).click();
  await page.getByLabel('Buscar en este fallo').fill('responsabilidad civil');
  const searchButton = page.getByRole('button', { name: 'Buscar', exact: true });
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(page.locator('#pdf-document-search-status')).toHaveText('1 de 1 · Página 50');
  await expect(page.locator('iframe')).toHaveAttribute('src', /page=50/u);
});

test('search continuity controls remain usable without horizontal overflow at target viewports', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/consulta?q=responsabilidad%20civil&page=2');
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Copiar enlace de búsqueda' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('private collections keep references and notes scoped while collection actions are XSS-safe', async ({ page }) => {
  const { calls } = await installApiMocks(page, true);
  const collectionName = '<script>window.__researchXss = true</script>';
  await page.goto('/colecciones');
  await page.getByLabel('Crear colección').fill(collectionName);
  await page.getByRole('button', { name: 'Crear colección', exact: true }).click();
  await expect(page.getByRole('heading', { name: collectionName })).toBeVisible();
  const collectionCard = page.locator('article').filter({ has: page.getByRole('heading', { name: collectionName }) });
  await expect(collectionCard.locator('img[onerror], script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __researchXss?: boolean }).__researchXss)).toBeUndefined();

  await page.goto('/consulta?q=responsabilidad');
  await page.getByRole('button', { name: 'Agregar a colección' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar a una colección' });
  await expect(dialog).toContainText('privadas de tu cuenta');
  await dialog.getByRole('button', { name: 'Agregar fallo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Fallo agregado a la colección' })).toBeVisible();
  expect(calls.some((call) => call.path === '/research/collections/1/items/77' && call.method === 'POST')).toBe(true);

  await page.goto('/colecciones/1');
  await expect(page.getByRole('heading', { name: collectionName })).toBeVisible();
  const note = '<img src=x onerror="window.__researchXss = true">';
  await page.getByLabel('Nota privada sobre este fallo').fill(note);
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nota privada guardada' })).toBeVisible();
  const itemCard = page.locator('article').filter({ has: page.getByLabel('Nota privada sobre este fallo') });
  await expect(itemCard.locator('img[onerror], script')).toHaveCount(0);
  const noteCall = calls.find((call) => call.path.endsWith('/note') && call.method === 'PATCH');
  expect(noteCall?.body).toEqual({ nota: note });

  await page.getByRole('button', { name: 'Quitar de colección' }).click();
  await expect(page.getByText('La colección está vacía')).toBeVisible();
  expect(calls.some((call) => call.path === '/research/collections/1/items/1' && call.method === 'DELETE')).toBe(true);
});
