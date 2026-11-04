export const COMMON_JURISPRUDENCE_SEARCH_PATH = '/consulta';
export const INTERNAL_JURISPRUDENCE_SEARCH_PATH = '/busqueda';
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
  if (canAccessAdvancedJurisprudenceSearch(roleName)) return ADVANCED_JURISPRUDENCE_SEARCH_PATH;
  return roleName ? INTERNAL_JURISPRUDENCE_SEARCH_PATH : COMMON_JURISPRUDENCE_SEARCH_PATH;
}
