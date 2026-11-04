import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCED_JURISPRUDENCE_SEARCH_PATH,
  COMMON_JURISPRUDENCE_SEARCH_PATH,
  INTERNAL_JURISPRUDENCE_SEARCH_PATH,
  canAccessAdvancedJurisprudenceSearch,
  jurisprudenceSearchPathForRole,
} from '../src/lib/jurisprudence-search-access.ts';

const profiles = [
  { name: 'Público anónimo', role: null, advanced: false },
  { name: 'Sala Viewer', role: 'LECTOR', advanced: false },
  { name: 'Sala Editor', role: 'OPERADOR', advanced: false },
  { name: 'Juzgado Viewer', role: 'LECTOR', advanced: false },
  { name: 'Juzgado Editor', role: 'OPERADOR', advanced: false },
  { name: 'Revisor', role: 'REVISOR', advanced: false },
  { name: 'Jurisprudencia', role: 'JURISPRUDENCIA', advanced: true },
  { name: 'Admin sin Jurisprudencia', role: 'ADMIN', advanced: false },
];

for (const profile of profiles) {
  test(`${profile.name}: común disponible y avanzada según rol`, () => {
    assert.equal(COMMON_JURISPRUDENCE_SEARCH_PATH, '/consulta');
    assert.equal(canAccessAdvancedJurisprudenceSearch(profile.role), profile.advanced);
    assert.equal(
      jurisprudenceSearchPathForRole(profile.role),
      profile.advanced
        ? ADVANCED_JURISPRUDENCE_SEARCH_PATH
        : profile.role
          ? INTERNAL_JURISPRUDENCE_SEARCH_PATH
          : COMMON_JURISPRUDENCE_SEARCH_PATH,
    );
  });
}

test('un rol combinado no expresable no obtiene acceso por privilegio Admin', () => {
  assert.equal(canAccessAdvancedJurisprudenceSearch('ADMIN+JURISPRUDENCIA'), false);
});
