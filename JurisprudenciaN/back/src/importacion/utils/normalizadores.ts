export function normalizeNullableString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized.length ? normalized : undefined;
}

export function normalizeBoolean(
  value: unknown,
  defaultValue = false,
): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return [
    '1',
    'true',
    't',
    's',
    'si',
    'y',
    'yes',
    'activo',
    'activa',
    'habilitado',
    'habilitada',
    'publicado',
    'publicada',
    'visible',
  ].includes(normalized);
}

export function normalizeLegacyId(value: unknown): string | undefined {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized : undefined;
}

export function normalizeSearchSummary(
  ...parts: Array<string | undefined>
): string | undefined {
  const value = parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return value || undefined;
}

export function parseLegacyDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value > 9999999999 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  const ddmmyyyy = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  if (ddmmyyyy) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = ddmmyyyy;
    const date = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeFilenameKey(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeLegacyExpediente(value: unknown): string | undefined {
  const normalized = normalizeNullableString(value);
  return normalized?.replace(/[^\dA-Za-z]/g, '') || undefined;
}
