export const COMMON_JURISPRUDENCE_SEARCH_PATH = '/consulta';
export const ADVANCED_JURISPRUDENCE_SEARCH_PATH = '/busqueda-avanzada';

/**
 * The current identity model exposes one global role and has no secondary
 * Jurisprudencia membership. Keep this capability tied to that exact role.
 */
export function canAccessAdvancedJurisprudenceSearch(
  roleName: string | null | undefined,
) {
  return roleName === 'JURISPRUDENCIA';
}

export function jurisprudenceSearchPathForRole(
  roleName: string | null | undefined,
) {
  return canAccessAdvancedJurisprudenceSearch(roleName)
    ? ADVANCED_JURISPRUDENCE_SEARCH_PATH
    : COMMON_JURISPRUDENCE_SEARCH_PATH;
}
