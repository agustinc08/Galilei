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

async function installApiMocks(page: Page, authenticated = false) {
  const favorites = new Set<number>();
  const saved: Array<Record<string, unknown>> = [];
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
    }, ADMIN);
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

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/u, '');
    const method = request.method();
    let body: unknown;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    calls.push({ method, path, body });

    if (path === '/auth/me' && method === 'GET') return route.fulfill({ json: ADMIN });
    if (path === '/public/busqueda' && method === 'GET') {
      return route.fulfill({ json: {
        data: [DEMO_RESULT],
        meta: {
          total: 1,
          page: Number(url.searchParams.get('page') ?? '1'),
          pageSize: Number(url.searchParams.get('pageSize') ?? '25'),
          pageCount: 1,
        },
      } });
    }
    if (path === '/public/busqueda/interpretacion' && method === 'GET') {
      return route.fulfill({ json: { data: { summary: 'La consulta busca desde el inicio de cada palabra.', notes: 'Las tildes se toleran; ñ se mantiene distinta de n.' } } });
    }
    if (path === '/public/busqueda/temas' || path === '/public/sentencias/recientes') return route.fulfill({ json: { data: [] } });
    if (path === '/catalogos/salas') return route.fulfill({ json: { data: [{ id: 1, nombre: 'C', activo: true }] } });
    if (path.startsWith('/catalogos/')) return route.fulfill({ json: { data: [] } });
    if (path === `/public/sentencias/${DEMO_RESULT.slugPublico}` && method === 'GET') {
      return route.fulfill({ json: { data: makePublicSentence() } });
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
    return route.fulfill({ status: 404, json: { message: `Unmocked test API: ${method} ${path}` } });
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

test('search continuity controls remain usable without horizontal overflow at target viewports', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/consulta?q=responsabilidad%20civil&page=2');
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Copiar enlace de búsqueda' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
