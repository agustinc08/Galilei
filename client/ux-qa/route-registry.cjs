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
  { id: 'GALILEI_HOME', route: '/galilei' },
  { id: 'MY_DOCUMENTS', route: '/personal' },
  { id: 'SPACE_MANAGE', route: '/spaces/manage' },
].map((route) => ({
  ...route,
  requiresAuth: true,
  roleScenario: 'AUTHENTICATED',
  screenshots: false,
  responsive: true,
  expectedAvailability: 'PRESENT_AUTHENTICATED',
}));

const authScenarios = [
  'ONE_DEPENDENCY',
  'MULTI_DEPENDENCY',
  'PERSONAL_OWNER',
  'SHARED_MEMBER',
  'SHARED_NON_MEMBER',
  'RESTRICTED_ALLOWED',
  'RESTRICTED_DENIED',
  'ADMIN_OPERATOR',
].map((id) => ({ id, status: 'DEFERRED_AUTH', credentials: 'ENV_ONLY' }));

module.exports = { publicRoutes, authenticatedRoutes, authScenarios };
