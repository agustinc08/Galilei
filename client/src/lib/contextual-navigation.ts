const INTERNAL_RETURN_ROOTS = [
  { path: '/spaces', label: 'Mi Sala / Juzgado' },
  { path: '/personal', label: 'Mis documentos' },
  { path: '/colecciones', label: 'Mis colecciones' },
  { path: '/busqueda-avanzada', label: 'Búsqueda avanzada' },
  { path: '/consulta', label: 'Jurisprudencia' },
] as const;

export type ContextualReturnTarget = {
  href: string;
  label: string;
};

export function safeContextualReturnTarget(value: string | null | undefined): ContextualReturnTarget | null {
  const candidate = value?.trim() ?? '';
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return null;

  let target: URL;
  try {
    target = new URL(candidate, 'https://galilei.invalid');
  } catch {
    return null;
  }
  if (target.origin !== 'https://galilei.invalid' || target.username || target.password) return null;

  const root = INTERNAL_RETURN_ROOTS.find(({ path }) =>
    target.pathname === path || target.pathname.startsWith(`${path}/`),
  );
  if (!root) return null;

  const label = root.path === '/colecciones' && target.pathname !== root.path
    ? 'la colección'
    : root.label;
  return {
    href: `${target.pathname}${target.search}${target.hash}`,
    label: `Volver a ${label}`,
  };
}
