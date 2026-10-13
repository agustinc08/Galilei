import { Injectable } from '@nestjs/common';

export type NormaDetectada = {
  tipoNorma: string;
  numeroNorma?: string;
  articulo?: string;
  inciso?: string;
  textoReferencia: string;
};

@Injectable()
export class NormasDetectorService {
  detectar(texto: string): NormaDetectada[] {
    const source = texto.replace(/\s+/g, ' ').trim();
    if (!source) {
      return [];
    }

    const detectadas: NormaDetectada[] = [];
    const context = (index: number) =>
      source.slice(Math.max(0, index - 80), Math.min(source.length, index + 160)).trim();

    const articuloRegex =
      /\b(?:arts?\.?|articulos?|artículos?)\s+([0-9]{1,5})(?:\s*(?:,|y)\s*([0-9]{1,5}))?(?:\s+inc\.?\s*([0-9a-zA-Z]+))?(?:\s+(CCyC|CPCCN|Cód(?:igo)?\.?\s+Civil\s+y\s+Comercial|Código\s+Civil\s+y\s+Comercial|Código\s+Procesal\s+Civil\s+y\s+Comercial\s+de\s+la\s+Nación))?/giu;

    for (const match of source.matchAll(articuloRegex)) {
      const norma = this.normalizeNorma(match[4]);
      for (const articulo of [match[1], match[2]].filter(Boolean)) {
        detectadas.push({
          tipoNorma: norma,
          articulo,
          inciso: match[3],
          textoReferencia: context(match.index ?? 0),
        });
      }
    }

    const leyRegex = /\b[Ll]ey\s+([0-9]{1,3}(?:\.[0-9]{3})?)\b/gu;
    for (const match of source.matchAll(leyRegex)) {
      detectadas.push({
        tipoNorma: 'LEY',
        numeroNorma: match[1],
        textoReferencia: context(match.index ?? 0),
      });
    }

    const codigoRegex =
      /\b(CCyC|CPCCN|Código Civil y Comercial|Código Procesal Civil y Comercial de la Nación)\b/giu;
    for (const match of source.matchAll(codigoRegex)) {
      detectadas.push({
        tipoNorma: this.normalizeNorma(match[1]),
        textoReferencia: context(match.index ?? 0),
      });
    }

    return this.unique(detectadas);
  }

  private normalizeNorma(value?: string) {
    if (!value) {
      return 'NORMA';
    }
    const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    if (normalized.includes('cpccn') || normalized.includes('procesal')) {
      return 'CPCCN';
    }
    if (normalized.includes('ccyc') || normalized.includes('civil y comercial')) {
      return 'CCyC';
    }
    return value.trim();
  }

  private unique(items: NormaDetectada[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = [item.tipoNorma, item.numeroNorma ?? '', item.articulo ?? '', item.inciso ?? ''].join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
