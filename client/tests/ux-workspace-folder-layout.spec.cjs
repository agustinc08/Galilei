'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function folder(id, name, { parentId = null, documents = 0, children = 0 } = {}) {
  return {
    id,
    parentId,
    name,
    visibilityScope: parentId ? 'INHERIT' : 'DEPENDENCY_SHARED',
    effectiveVisibilityScope: 'DEPENDENCY_SHARED',
    visibilityLabel: 'Compartida con Sala QA',
    canManageAccess: true,
    _count: { documents, children },
  };
}

test('folder cards wrap, stay readable, and retain folder actions across breakpoints @folder-layout @workspace', async ({ page }) => {
  const workspaceId = 'workspace-folder-layout-qa';
  const workspace = {
    id: workspaceId,
    code: 'SALA-LAYOUT-QA',
    name: 'Sala QA de diseño',
    type: 'SALA',
    role: 'ADMIN',
  };
  const longName = 'QA carpeta con un nombre deliberadamente muy largo para revisar el ajuste responsive sin comprimir las acciones ni ocultar los contadores';
  let folders = [
    folder('qa-short', 'QA breve'),
    folder('qa-medium', 'QA carpeta intermedia'),
    folder('qa-long', longName),
    folder('qa-parent', 'QA carpeta con subcarpetas', { children: 1 }),
    folder('qa-documents', 'QA carpeta con documentos', { documents: 2 }),
    folder('qa-empty', 'QA carpeta vacía'),
    folder('qa-seven', 'QA carpeta siete'),
    folder('qa-eight', 'QA carpeta ocho'),
    folder('qa-nine', 'QA carpeta nueve'),
    folder('qa-ten', 'QA carpeta diez'),
    folder('qa-parent-child', 'QA subcarpeta existente', { parentId: 'qa-parent' }),
  ];
  const createdFolders = [];
  const renamedFolders = [];
  const deletedFolders = [];

  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-folder-layout-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, {
    id: 8910,
    nombre: 'Cuenta',
    apellido: 'QA Layout',
    email: 'folder-layout-qa@example.invalid',
    activo: true,
    rol: { id: 1, nombre: 'ADMIN' },
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') {
      return json(route, {
        id: 8910,
        nombre: 'Cuenta',
        apellido: 'QA Layout',
        email: 'folder-layout-qa@example.invalid',
        activo: true,
        rol: { id: 1, nombre: 'ADMIN' },
      });
    }
    if (pathname === '/api/workspaces/mine') return json(route, [workspace]);
    if (pathname === '/api/workspaces/admin/list') {
      return json(route, [{ ...workspace, active: true, administrators: [] }]);
    }
    if (pathname === `/api/workspaces/${workspaceId}/folders` && method === 'GET') {
      return json(route, folders);
    }
    if (pathname === `/api/workspaces/${workspaceId}/folders` && method === 'POST') {
      const payload = request.postDataJSON();
      const id = `qa-created-${createdFolders.length + 1}`;
      const added = folder(id, payload.name, { parentId: payload.parentId ?? null });
      folders = [...folders, added];
      createdFolders.push({ id, ...payload });
      if (payload.parentId) {
        folders = folders.map((item) => item.id === payload.parentId
          ? { ...item, _count: { ...item._count, children: item._count.children + 1 } }
          : item);
      }
      return json(route, added);
    }
    const folderPath = new RegExp(`^/api/workspaces/${workspaceId}/folders/([^/]+)$`, 'u');
    const folderMatch = pathname.match(folderPath);
    if (folderMatch && method === 'PATCH') {
      const id = decodeURIComponent(folderMatch[1]);
      const payload = request.postDataJSON();
      folders = folders.map((item) => item.id === id ? { ...item, name: payload.name } : item);
      renamedFolders.push({ id, ...payload });
      return json(route, folders.find((item) => item.id === id));
    }
    if (folderMatch && method === 'DELETE') {
      const id = decodeURIComponent(folderMatch[1]);
      deletedFolders.push(id);
      const parent = folders.find((item) => item.id === folders.find((folderItem) => folderItem.id === id)?.parentId);
      folders = folders.filter((item) => item.id !== id);
      if (parent) {
        folders = folders.map((item) => item.id === parent.id
          ? { ...item, _count: { ...item._count, children: Math.max(0, item._count.children - 1) } }
          : item);
      }
      return json(route, { id, deleted: true });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents`) return json(route, []);
    if (/^\/api\/workspaces\/workspace-folder-layout-qa\/(members|activity|sources)$/u.test(pathname)) {
      return json(route, []);
    }
    return json(route, {});
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/spaces/manage?workspaceId=${workspaceId}`);
  await expect(page.getByRole('heading', { name: 'Carpetas y documentos' })).toBeVisible();
  const grid = page.getByTestId('workspace-folder-grid');
  const cards = grid.getByTestId('workspace-folder-card');
  await expect(cards).toHaveCount(10);
  await expect(cards.filter({ hasText: longName })).toBeVisible();
  await expect(cards.filter({ hasText: 'QA carpeta con subcarpetas' })).toContainText('1 subcarpetas');
  await expect(cards.filter({ hasText: 'QA carpeta con documentos' })).toContainText('2 documentos');
  await expect(cards.filter({ hasText: 'QA carpeta vacía' })).toContainText('0 documentos');
  await page.evaluate(() => document.fonts.ready);

  const viewportMatrix = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];
  let desktopColumns = 0;
  for (const viewport of viewportMatrix) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const gridElement = document.querySelector('[data-testid="workspace-folder-grid"]');
      const cardElements = Array.from(gridElement?.querySelectorAll('[data-testid="workspace-folder-card"]') ?? []);
      const cards = cardElements.map((card) => {
        const cardRect = card.getBoundingClientRect();
        const actions = card.querySelector('[data-testid="workspace-folder-actions"]');
        const controls = Array.from(actions?.querySelectorAll('button, summary') ?? [])
          .filter((control) => getComputedStyle(control).display !== 'none' && control.getClientRects().length > 0);
        const name = card.querySelector('[data-testid="workspace-folder-open"] span');
        return {
          x: cardRect.x,
          y: cardRect.y,
          width: cardRect.width,
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
          controlsInside: controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1;
          }),
          controlsTallEnough: controls.every((control) => control.getBoundingClientRect().height >= 44),
          nameOverflows: name ? name.scrollWidth > name.clientWidth + 1 : false,
        };
      });
      const form = document.querySelector('[data-testid="workspace-folder-create-form"]');
      const formRect = form?.getBoundingClientRect();
      const formControls = Array.from(form?.querySelectorAll('input, select, button') ?? [])
        .filter((control) => getComputedStyle(control).display !== 'none');
      const formRects = formControls.map((control) => control.getBoundingClientRect());
      const formControlsOverlap = formRects.some((rect, index) => formRects.slice(index + 1).some((other) =>
        rect.left < other.right - 1 && rect.right > other.left + 1 &&
        rect.top < other.bottom - 1 && rect.bottom > other.top + 1));
      const gridRect = gridElement?.getBoundingClientRect();
      const rowYs = [...new Set(cards.map((card) => Math.round(card.y)))];
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        gridWidth: gridElement?.clientWidth ?? 0,
        gridScrollWidth: gridElement?.scrollWidth ?? 0,
        gridRight: gridRect?.right ?? 0,
        columnCount: cards.reduce((count, card) => count + (Math.abs(card.y - cards[0].y) < 2 ? 1 : 0), 0),
        rowCount: rowYs.length,
        cards,
        formClientWidth: form?.clientWidth ?? 0,
        formScrollWidth: form?.scrollWidth ?? 0,
        formRight: formRect?.right ?? 0,
        formControlsOverlap,
      };
    });
    expect(layout.documentWidth, `horizontal page overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width);
    expect(layout.gridScrollWidth, `folder grid overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify({ width: layout.gridWidth, scrollWidth: layout.gridScrollWidth, right: layout.gridRight, documentWidth: layout.documentWidth })}`).toBeLessThanOrEqual(layout.gridWidth);
    expect(layout.gridRight, `folder grid extends beyond viewport at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.cards.every((card) => card.width >= Math.min(280, layout.gridWidth - 1)), `folder card too narrow at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout.cards.map(({ width }) => width))}`).toBe(true);
    expect(layout.cards.every((card) => card.scrollWidth <= card.clientWidth + 1), `folder card content overflows at ${viewport.width}x${viewport.height}`).toBe(true);
    expect(layout.cards.every((card) => card.controlsInside), `folder action escaped its card at ${viewport.width}x${viewport.height}`).toBe(true);
    expect(layout.cards.every((card) => card.controlsTallEnough), `folder action target is too small at ${viewport.width}x${viewport.height}`).toBe(true);
    expect(layout.cards.some((card) => card.nameOverflows), `folder name overflowed its content box at ${viewport.width}x${viewport.height}`).toBe(false);
    expect(layout.formScrollWidth, `folder form overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(layout.formClientWidth);
    expect(layout.formRight, `folder form extends beyond viewport at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.formControlsOverlap, `new folder controls overlap at ${viewport.width}x${viewport.height}`).toBe(false);
    if (viewport.width === 768 && layout.gridWidth >= 572) expect(layout.columnCount).toBeGreaterThanOrEqual(2);
    if (viewport.width === 1024 && layout.gridWidth >= 572) expect(layout.columnCount).toBeGreaterThanOrEqual(2);
    if (viewport.width === 1920) desktopColumns = layout.columnCount;
  }
  expect(desktopColumns).toBeGreaterThanOrEqual(2);
  expect(desktopColumns).toBeLessThanOrEqual(4);

  const folderForm = page.getByTestId('workspace-folder-create-form');
  const parentCard = cards.filter({ hasText: 'QA carpeta con subcarpetas' });
  await parentCard.getByTestId('workspace-folder-open').press('Enter');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('QA subcarpeta existente');
  await expect(page.getByPlaceholder('Nombre de subcarpeta')).toBeVisible();
  await page.getByRole('button', { name: 'Documentos compartidos', exact: true }).click();
  await expect(cards).toHaveCount(10);

  const newFolderName = 'QA Layout Smoke Nueva';
  const renamedFolderName = 'QA Layout Smoke Renombrada';
  await folderForm.getByLabel('Nombre de carpeta', { exact: true }).fill(newFolderName);
  await folderForm.getByRole('button', { name: 'Crear carpeta', exact: true }).click();
  const createdCard = cards.filter({ hasText: newFolderName });
  await expect(createdCard).toBeVisible();
  await createdCard.getByRole('button', { name: `Renombrar ${newFolderName}` }).click();
  const renameInput = page.getByLabel('Nuevo nombre de carpeta');
  await renameInput.fill(renamedFolderName);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  const renamedCard = cards.filter({ hasText: renamedFolderName });
  await expect(renamedCard).toBeVisible();
  await renamedCard.getByText('Eliminar carpeta', { exact: true }).click();
  await renamedCard.getByLabel('Motivo de eliminación').fill('Fixture QA reversible');
  await renamedCard.getByRole('button', { name: 'Eliminar carpeta vacía', exact: true }).click();
  await expect(cards.filter({ hasText: renamedFolderName })).toHaveCount(0);

  const protectedFolders = [
    cards.filter({ hasText: 'QA carpeta con subcarpetas' }),
    cards.filter({ hasText: 'QA carpeta con documentos' }),
  ];
  for (const protectedCard of protectedFolders) {
    await protectedCard.getByText('Eliminar carpeta', { exact: true }).click();
    await protectedCard.getByLabel('Motivo de eliminación').fill('Validar protección QA');
    await expect(protectedCard.getByRole('button', { name: 'Eliminar carpeta vacía', exact: true })).toBeDisabled();
  }
  expect(createdFolders.map((item) => item.name)).toEqual([newFolderName]);
  expect(renamedFolders).toEqual([{ id: createdFolders[0].id, name: renamedFolderName }]);
  expect(deletedFolders).toEqual([createdFolders[0].id]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});
