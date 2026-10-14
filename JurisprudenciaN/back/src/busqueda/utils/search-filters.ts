import { BadRequestException } from '@nestjs/common';

export type CorpusFileType = 'PDF' | 'TXT';

export type SearchDateRange = {
  dateFrom?: string;
  dateTo?: string;
};

export function validateDateOnly(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new BadRequestException(`${label} debe tener formato AAAA-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new BadRequestException(`${label} no es una fecha válida.`);
  }
  return value;
}

export function validateSearchDateRange(
  dateFrom: unknown,
  dateTo: unknown,
): SearchDateRange {
  const from = validateDateOnly(dateFrom, 'dateFrom');
  const to = validateDateOnly(dateTo, 'dateTo');
  if (from && to && from > to) {
    throw new BadRequestException('dateFrom no puede ser posterior a dateTo.');
  }
  return { ...(from ? { dateFrom: from } : {}), ...(to ? { dateTo: to } : {}) };
}

export function validateCorpusTypes(
  value: unknown,
): CorpusFileType[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const rawTypes = Array.isArray(value) ? value : [value];
  if (!rawTypes.every((item) => typeof item === 'string')) {
    throw new BadRequestException('types sólo admite PDF y TXT.');
  }
  const types = [
    ...new Set(rawTypes.map((item) => String(item).trim().toUpperCase())),
  ];
  if (!types.length || types.some((type) => type !== 'PDF' && type !== 'TXT')) {
    throw new BadRequestException('types sólo admite PDF y TXT.');
  }
  return types as CorpusFileType[];
}

export function mimeTypesForCorpusTypes(types: CorpusFileType[]) {
  return types.map((type) =>
    type === 'PDF' ? 'application/pdf' : 'text/plain',
  );
}
