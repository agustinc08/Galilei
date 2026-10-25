'use strict';

const publicRoutes = [
  {
    id: 'HOME', route: '/', requiresAuth: false, roleScenario: 'PUBLIC',
    screenshots: true, responsive: true, expectedAvailability: 'PRESENT',
  },
  {
    id: 'LOGIN', route: '/login', requiresAuth: false, roleScenario: 'PUBLIC',
    screenshots: true, responsive: true, expectedAvailability: 'PRESENT',
  },
  {
    id: 'PUBLIC_SEARCH', route: '/consulta', requiresAuth: false, roleScenario: 'PUBLIC',
    screenshots: true, responsive: true, expectedAvailability: 'PRESENT',
  },
  {
    id: 'PUBLIC_VIEWER', route: '/fallos/ux-qa-001', requiresAuth: false, roleScenario: 'PUBLIC',
    screenshots: true, responsive: true, expectedAvailability: 'PRESENT',
    fixture: 'synthetic-public-document',
  },
];

const authenticatedRoutes = [
  { id: 'GALILEI_HOME', route: '/galilei', coverageFiles: ['tests/galilei-navigation.e2e.spec.ts'] },
  { id: 'MY_DOCUMENTS', route: '/personal', coverageFiles: ['tests/copernic-ux-states.e2e.spec.ts', 'tests/workspace-uat.e2e.spec.ts'] },
  { id: 'SPACE_MANAGE', route: '/spaces/manage', coverageFiles: ['tests/galilei-navigation.e2e.spec.ts', 'tests/workspace-uat.e2e.spec.ts'] },
].map((route) => ({
  ...route,
  requiresAuth: true,
  roleScenario: 'AUTHENTICATED',
  screenshots: false,
  responsive: true,
  expectedAvailability: 'PRESENT_AUTHENTICATED',
  status: 'COVERED_BY_PRODUCT_E2E',
}));

const authScenarios = [
  { id: 'ONE_DEPENDENCY', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts'] },
  { id: 'MULTI_DEPENDENCY', coverageFiles: ['tests/workspace-uat.e2e.spec.ts'] },
  { id: 'PERSONAL_OWNER', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts', 'tests/workspace-uat.e2e.spec.ts'] },
  { id: 'SHARED_MEMBER', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts', 'tests/workspace-uat.e2e.spec.ts'] },
  { id: 'SHARED_NON_MEMBER', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts'] },
  { id: 'RESTRICTED_ALLOWED', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts'] },
  { id: 'RESTRICTED_DENIED', coverageFiles: ['tests/sprint1561-personal-acl.e2e.spec.ts'] },
  { id: 'ADMIN_OPERATOR', coverageFiles: ['tests/jurisprudencia-j9.e2e.spec.ts', 'tests/jurisprudencia-j901.e2e.spec.ts'] },
].map((scenario) => ({ ...scenario, status: 'COVERED_BY_PRODUCT_E2E', credentials: 'ISOLATED_QA' }));

module.exports = { publicRoutes, authenticatedRoutes, authScenarios };
