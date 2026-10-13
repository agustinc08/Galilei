export type DetectedCita = {
  tipo: string;
  referencia: string;
  textoOriginal: string;
  contexto: string;
  pagina?: number | null;
};

type PatternConfig = {
  tipo: string;
  regex: RegExp;
  normalize: (match: string) => string;
};

const PATTERNS: PatternConfig[] = [
  {
    tipo: 'FALLOS',
    regex: /\bFallos\s*:?\s*(\d{2,4}:\d{1,5})\b/gi,
    normalize: (match) =>
      match.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':').trim(),
  },
  {
    tipo: 'CSJ',
    regex: /\bCSJ\s+([A-Z0-9]{1,6}\/\d{4})\b/gi,
    normalize: (match) => match.replace(/\s+/g, ' ').trim().toUpperCase(),
  },
  {
    tipo: 'CAF',
    regex: /\bCAF\s+([0-9]{1,6}\/\d{4}(?:\/[A-Z0-9]+)?)\b/gi,
    normalize: (match) => match.replace(/\s+/g, ' ').trim().toUpperCase(),
  },
  {
    tipo: 'CIV',
    regex: /\bCIV\s+([0-9]{1,6}\/\d{4})\b/gi,
    normalize: (match) => match.replace(/\s+/g, ' ').trim().toUpperCase(),
  },
  {
    tipo: 'EXPEDIENTE',
    regex:
      /\b(?:Expte\.?|Expediente(?:\s+N[°º])?|causa(?:\s+N[°º])?)\s*:?\s*([0-9]{1,6}\/\d{4}(?:\/[A-Z0-9]+)?)\b/gi,
    normalize: (match) =>
      match.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ': ').trim(),
  },
  {
    tipo: 'SALA',
    regex: /\bCNCiv,\s*Sala\s+([A-Z])\b/gi,
    normalize: (match) => match.replace(/\s+/g, ' ').trim(),
  },
  {
    tipo: 'SALA_FECHA',
    regex: /\bSala\s+([A-Z]),\s*(\d{2}\/\d{2}\/\d{4})\b/gi,
    normalize: (match) => match.replace(/\s+/g, ' ').trim(),
  },
];

function buildContext(text: string, start: number, end: number, radius = 200) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function buildReference(tipo: string, rawMatch: string) {
  if (tipo === 'FALLOS') {
    const ref = rawMatch.match(/(\d{2,4}:\d{1,5})/i)?.[1] ?? rawMatch;
    return `Fallos: ${ref}`;
  }

  return rawMatch.replace(/\s+/g, ' ').trim().toUpperCase();
}

export function detectCitasInText(text: string) {
  const detected: DetectedCita[] = [];

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex);
    let match: RegExpExecArray | null = regex.exec(text);

    while (match) {
      const textoOriginal = match[0].trim();
      const referencia = buildReference(
        pattern.tipo,
        pattern.normalize(textoOriginal),
      );

      detected.push({
        tipo: pattern.tipo,
        referencia,
        textoOriginal,
        contexto: buildContext(text, match.index, match.index + match[0].length),
        pagina: null,
      });

      match = regex.exec(text);
    }
  }

  const unique = new Map<string, DetectedCita>();
  for (const item of detected) {
    unique.set(`${item.tipo}::${item.referencia}`, item);
  }

  return [...unique.values()];
}

export const CITA_PATTERNS_HELP = [
  'Fallos: 342:533',
  'Fallos 336:2231',
  'CSJ 58/2014',
  'CAF 35134/2018/CS2',
  'CIV 12345/2020',
  'Expte. 12345/2020',
  'Expediente N° 12345/2020',
  'causa N° 12345/2020',
  'CNCiv, Sala A',
  'Sala A, 12/03/2024',
];
