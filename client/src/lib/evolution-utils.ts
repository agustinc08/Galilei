export type EvolutionEventDate = { slug: string; decisionDate: string | null };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

export function publicEvolutionHref(slugs: string[]): string {
  const path = `/evolucion?ids=${slugs.map(encodeURIComponent).join(',')}`;
  return path.length <= 1800 ? path : '/evolucion';
}

export function parseEvolutionSlugs(raw: string | null): string[] | null {
  if (raw === null) return [];
  if (!raw) return null;
  const slugs = raw.split(',').map((slug) => slug.trim());
  if (
    slugs.length < 2 ||
    slugs.length > 50 ||
    slugs.some((slug) => !SLUG.test(slug)) ||
    new Set(slugs).size !== slugs.length
  ) return null;
  return slugs;
}

export function sortEvolutionEvents<T extends EvolutionEventDate>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftTime = left.decisionDate ? Date.parse(left.decisionDate) : Number.NaN;
    const rightTime = right.decisionDate ? Date.parse(right.decisionDate) : Number.NaN;
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (leftValid && rightValid && leftTime !== rightTime) return leftTime - rightTime;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    return left.slug.localeCompare(right.slug, 'es');
  });
}

export function evolutionYear(decisionDate: string | null) {
  if (!decisionDate) return null;
  const time = Date.parse(decisionDate);
  return Number.isFinite(time) ? new Date(time).getUTCFullYear() : null;
}
