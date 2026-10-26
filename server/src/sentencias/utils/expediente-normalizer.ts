const CASE_YEAR =
  /^(?<prefix>.+?)\s*(?<separator>[/-])\s*(?<year>(?:19|20)\d{2})$/u;

export function normalizeExpediente(value: string | null | undefined) {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleUpperCase('en-US');
  if (!normalized) return null;
  const match = CASE_YEAR.exec(normalized);
  const prefix = match?.groups?.prefix?.trim().replace(/\s+/gu, ' ');
  const year = match?.groups?.year;
  if (!prefix || !/[\p{L}\p{N}]/u.test(prefix) || !year) return null;
  return `${prefix}/${year}`;
}

export function expedienteEquivalentValues(value: string | null | undefined) {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleUpperCase('en-US');
  if (!normalized) return [];
  const match = CASE_YEAR.exec(normalized);
  const prefix = match?.groups?.prefix?.trim().replace(/\s+/gu, ' ');
  const year = match?.groups?.year;
  if (!prefix || !/[\p{L}\p{N}]/u.test(prefix) || !year) return [];
  const words = prefix.split(' ');
  const boundaries = words.length - 1;
  const prefixVariants = new Set([prefix]);
  const variantsFromMask = (mask: number) =>
    words
      .slice(0, -1)
      .map((word, index) => `${word}${mask & (1 << index) ? '  ' : ' '}`)
      .concat(words.at(-1)!)
      .join('');
  if (boundaries <= 5) {
    for (let mask = 1; mask < 2 ** boundaries; mask += 1) {
      prefixVariants.add(variantsFromMask(mask));
    }
  } else {
    prefixVariants.add(words.join('  '));
    words.slice(0, -1).forEach((_, index) => {
      prefixVariants.add(variantsFromMask(1 << index));
    });
  }
  return [
    ...new Set(
      [...prefixVariants].flatMap((variant) => [
        `${variant}/${year}`,
        `${variant} / ${year}`,
        `${variant}-${year}`,
        `${variant} - ${year}`,
      ]),
    ),
  ];
}
