import { createHash, randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';

export const RESEARCH_BUNDLE_SCHEMA_VERSION = 'galilei-research-bundle/1';

export type ResearchTextSourceProvenance = {
  source: 'PDF_TEXT' | 'OCR_APPROVED' | 'MIXED';
  pdfSha256: string;
  extractorVersion: string;
  documentTextSha256?: string;
  pages: Array<{
    pageNumber: number;
    source: 'PDF_TEXT' | 'OCR_APPROVED';
    textSha256?: string;
  }>;
};

export type ResearchBundleJudgment = {
  id: number;
  slugPublico: string | null;
  caratula: string | null;
  numeroSentencia: string | null;
  expediente: string | null;
  sala: string | null;
  fecha: Date | null;
  tipoFallo: string | null;
  nota: string | null;
  addedAt: Date;
  textProvenance?: ResearchTextSourceProvenance;
};

export type ResearchBundleInput = {
  collection: {
    id: number;
    nombre: string;
    createdAt: Date;
    updatedAt: Date;
  };
  judgments: ResearchBundleJudgment[];
  omittedItemCount: number;
  generatedAt: Date;
  gitSha?: string;
  judgmentOrder?: 'ADDED_AT' | 'INPUT';
  evolution?: {
    name: string;
    selectedJudgmentIds: number[];
    chronologicalSlugs: string[];
    relationTypes: Array<'VERIFIED_CITATION' | 'SAME_EXPEDIENTE'>;
    verifiedCitationEdges: Array<{
      sourceSlug: string;
      targetSlug: string;
      evidence: string;
      page: number | null;
    }>;
    sameExpedienteGroups: Array<{
      expediente: string;
      slugs: string[];
    }>;
  };
};

export type ResearchBundleFile = { path: string; content: string };

export type ResearchBundleManifest = {
  schemaVersion: typeof RESEARCH_BUNDLE_SCHEMA_VERSION;
  bundleId: string;
  generatedAt: string;
  application: { name: 'Galilei'; gitSha?: string };
  collection: {
    id: number;
    nombre: string;
    descripcion: null;
    createdAt: string;
    updatedAt: string;
  };
  contents: {
    judgmentCount: number;
    noteCount: number;
    filesGenerated: number;
  };
  judgments: Array<{
    id: number;
    numeroSentencia: string | null;
    sala: string | null;
    fecha: string | null;
    expediente: string | null;
    caratula: string | null;
    slugPublico: string | null;
    textProvenance?: ResearchTextSourceProvenance;
  }>;
  researchContext?: {
    type: 'JURISPRUDENTIAL_EVOLUTION';
    name: string;
    selectedJudgmentIds: number[];
    chronologicalSlugs: string[];
    relationTypes: Array<'VERIFIED_CITATION' | 'SAME_EXPEDIENTE'>;
  };
  hashes: Record<string, string>;
  warnings: Array<{ code: string; count: number; message: string }>;
};

export type ResearchBundle = {
  rootDirectory: string;
  downloadFilename: string;
  manifest: ResearchBundleManifest;
  files: ResearchBundleFile[];
};

export function createResearchBundleZip(files: ResearchBundleFile[]) {
  const stream = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (error: Error) => stream.destroy(error));
  archive.pipe(stream);
  for (const file of files) archive.append(file.content, { name: file.path });
  void archive.finalize().catch((error: Error) => stream.destroy(error));
  return stream;
}

function sha256(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function jsonFile(path: string, value: unknown): ResearchBundleFile {
  return { path, content: `${JSON.stringify(value, null, 2)}\n` };
}

function html(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function markdownText(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/\\/gu, '\\\\')
    .replace(/([`*_{}[\]()#+.!|>])/gu, '\\$1')
    .replace(/[\r\n]+/gu, ' ');
}

function codeFence(content: string) {
  const runs = content.match(/`+/gu) ?? [];
  const longest = runs.reduce(
    (maximum, run) => Math.max(maximum, run.length),
    2,
  );
  return '`'.repeat(longest + 1);
}

export function safeCollectionSlug(name: string, collectionId: number) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
    .replace(/-+$/gu, '');
  const safe =
    slug && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(slug)
      ? slug
      : `coleccion-${collectionId}`;
  return safe;
}

function reference(judgment: ResearchBundleJudgment) {
  return (
    [
      judgment.numeroSentencia ? `Sentencia ${judgment.numeroSentencia}` : null,
      judgment.sala ? `Sala ${judgment.sala}` : null,
      judgment.fecha ? judgment.fecha.toISOString().slice(0, 10) : null,
      judgment.expediente ? `Expte. ${judgment.expediente}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Referencia incompleta'
  );
}

function publicPath(slug: string | null) {
  return slug ? `/fallos/${encodeURIComponent(slug)}` : null;
}

function renderIndex(
  input: ResearchBundleInput,
  judgments: ResearchBundleJudgment[],
  warnings: ResearchBundleManifest['warnings'],
) {
  const cards = judgments.map((judgment) => {
    const path = publicPath(judgment.slugPublico);
    const metadata = [
      judgment.sala ? `Sala ${judgment.sala}` : null,
      judgment.fecha ? judgment.fecha.toISOString().slice(0, 10) : null,
      judgment.expediente ? `Expte. ${judgment.expediente}` : null,
      judgment.numeroSentencia ? `Sentencia ${judgment.numeroSentencia}` : null,
    ]
      .filter(Boolean)
      .map(html)
      .join(' · ');
    const title = html(
      judgment.caratula ?? judgment.numeroSentencia ?? `Fallo ${judgment.id}`,
    );
    const note = judgment.nota
      ? `<h3>Nota privada</h3><p class="note">${html(judgment.nota).replace(/\r?\n/gu, '<br>')}</p>`
      : '';
    const link = path
      ? `<a href="${html(path)}">Abrir publicación</a>`
      : '<span>Sin enlace público disponible</span>';
    const ocrPages =
      judgment.textProvenance?.pages
        .filter((page) => page.source === 'OCR_APPROVED')
        .map((page) => page.pageNumber) ?? [];
    const provenance = judgment.textProvenance
      ? `<p class="metadata">Texto de investigación: ${html(judgment.textProvenance.source === 'MIXED' ? 'PDF y OCR revisado' : judgment.textProvenance.source === 'OCR_APPROVED' ? 'OCR revisado' : 'texto del PDF')}${ocrPages.length ? ` · páginas físicas ${html(ocrPages.join(', '))}` : ''}</p>`
      : '';
    return `<article><h2>${title}</h2><p class="metadata">${metadata || 'Sin metadatos adicionales'}</p><p class="reference">${html(reference(judgment))}</p>${provenance}${note}<p>${link}</p></article>`;
  });
  const warningHtml = warnings.length
    ? `<section class="warnings"><h2>Advertencias</h2><ul>${warnings
        .map((warning) => `<li>${html(warning.message)}</li>`)
        .join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(input.collection.nombre)} — dossier Galilei</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#17212b;background:#f7f8fa}header,article,.warnings{background:white;border:1px solid #d8dee5;border-radius:12px;padding:20px;margin:0 0 16px}h1{font-size:1.7rem}h2{font-size:1.2rem;margin-top:0}.metadata,.reference{color:#526170}.note{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #8798aa;padding-left:12px}a{color:#155eef}.warnings{border-color:#f2c37d}</style></head>
<body><header><h1>${html(input.collection.nombre)}</h1><p>Dossier de investigación generado el <time>${html(input.generatedAt.toISOString())}</time>.</p><p>${judgments.length} fallos incluidos.</p></header>${warningHtml}${cards.length ? cards.join('\n') : '<p>La colección no contiene fallos públicos disponibles.</p>'}</body></html>\n`;
}

function renderReadme(
  input: ResearchBundleInput,
  judgments: ResearchBundleJudgment[],
  warnings: ResearchBundleManifest['warnings'],
) {
  const lines = [
    `# Dossier: ${markdownText(input.collection.nombre)}`,
    '',
    'Paquete autocontenido de metadatos y notas de una colección de Galilei. No incluye documentos PDF.',
    '',
    `- Generado: ${input.generatedAt.toISOString()}`,
    `- Colección: ${markdownText(input.collection.nombre)} (ID ${input.collection.id})`,
    `- Fallos incluidos: ${judgments.length}`,
    '',
    '## Fallos',
  ];
  if (!judgments.length)
    lines.push('', 'La colección no contiene fallos públicos disponibles.');
  for (const judgment of judgments) {
    const title = markdownText(
      judgment.caratula ?? judgment.numeroSentencia ?? `Fallo ${judgment.id}`,
    );
    const path = publicPath(judgment.slugPublico);
    lines.push(
      '',
      `### ${title}`,
      '',
      `- Referencia: ${markdownText(reference(judgment))}`,
      `- Sala: ${markdownText(judgment.sala ?? 'No informada')}`,
      `- Fecha: ${judgment.fecha?.toISOString().slice(0, 10) ?? 'No informada'}`,
      `- Expediente: ${markdownText(judgment.expediente ?? 'No informado')}`,
      `- Sentencia: ${markdownText(judgment.numeroSentencia ?? 'No informada')}`,
      `- Publicación: ${path ? `[Abrir fallo](${path})` : 'No disponible'}`,
    );
    if (judgment.textProvenance) {
      const ocrPages = judgment.textProvenance.pages
        .filter((page) => page.source === 'OCR_APPROVED')
        .map((page) => page.pageNumber);
      lines.push(
        `- Fuente textual activa: ${markdownText(judgment.textProvenance.source)}${ocrPages.length ? ` · páginas físicas con OCR revisado: ${ocrPages.join(', ')}` : ''}`,
      );
    }
    if (judgment.nota) {
      const fence = codeFence(judgment.nota);
      lines.push('', 'Nota privada:', '', fence, judgment.nota, fence);
    } else {
      lines.push('', 'Sin nota privada.');
    }
  }
  if (warnings.length) {
    lines.push('', '## Advertencias', '');
    warnings.forEach((warning) =>
      lines.push(`- ${markdownText(warning.message)}`),
    );
  }
  lines.push(
    '',
    'Los hashes SHA-256 de los archivos incluidos figuran en `manifest.json`. El manifiesto no incluye su propio hash.',
    '',
  );
  return lines.join('\n');
}

export function buildResearchBundle(
  input: ResearchBundleInput,
): ResearchBundle {
  const rootDirectory = `Investigacion-${safeCollectionSlug(input.collection.nombre, input.collection.id)}`;
  const generatedAt = input.generatedAt.toISOString();
  const judgments =
    input.judgmentOrder === 'INPUT'
      ? [...input.judgments]
      : [...input.judgments].sort(
          (left, right) =>
            left.addedAt.getTime() - right.addedAt.getTime() ||
            left.id - right.id,
        );
  const notes = judgments.filter((judgment) => Boolean(judgment.nota?.trim()));
  const warnings: ResearchBundleManifest['warnings'] = [];
  if (input.omittedItemCount > 0) {
    warnings.push({
      code: 'ITEMS_OMITTED_UNAVAILABLE_OR_FORBIDDEN',
      count: input.omittedItemCount,
      message: `${input.omittedItemCount} elemento(s) no pudo/pudieron incluirse por disponibilidad o permisos.`,
    });
  }
  const missingLinks = judgments.filter(
    (judgment) => !judgment.slugPublico,
  ).length;
  if (missingLinks > 0) {
    warnings.push({
      code: 'PUBLIC_LINK_UNAVAILABLE',
      count: missingLinks,
      message: `${missingLinks} fallo(s) no tiene(n) un enlace público disponible.`,
    });
  }
  const missingMetadata = judgments.filter(
    (judgment) => !judgment.fecha || !judgment.sala || !judgment.caratula,
  ).length;
  if (missingMetadata > 0) {
    warnings.push({
      code: 'INCOMPLETE_PUBLIC_METADATA',
      count: missingMetadata,
      message: `${missingMetadata} fallo(s) tiene(n) metadatos públicos incompletos.`,
    });
  }

  const collection = {
    id: input.collection.id,
    nombre: input.collection.nombre,
    descripcion: null,
    createdAt: input.collection.createdAt.toISOString(),
    updatedAt: input.collection.updatedAt.toISOString(),
  };
  const files: ResearchBundleFile[] = [
    jsonFile(`${rootDirectory}/collection.json`, collection),
  ];
  for (const judgment of judgments) {
    const directory = `${rootDirectory}/fallos/sentencia-${judgment.id}`;
    const metadata = {
      id: judgment.id,
      numeroSentencia: judgment.numeroSentencia,
      tipoFallo: judgment.tipoFallo,
      sala: judgment.sala,
      fecha: judgment.fecha?.toISOString() ?? null,
      expediente: judgment.expediente,
      caratula: judgment.caratula,
      slugPublico: judgment.slugPublico,
      ...(judgment.textProvenance
        ? { textProvenance: judgment.textProvenance }
        : {}),
    };
    files.push(
      jsonFile(`${directory}/metadata.json`, metadata),
      {
        path: `${directory}/referencia.txt`,
        content: `${reference(judgment)}\n`,
      },
      jsonFile(`${directory}/fuente.json`, {
        application: 'Galilei',
        visibility: 'PUBLIC',
        publicPath: publicPath(judgment.slugPublico),
      }),
    );
    if (judgment.nota?.trim()) {
      files.push({
        path: `${directory}/notas.md`,
        content: [
          '# Nota privada',
          '',
          'Contenido literal del usuario; se muestra como texto y no se interpreta como Markdown.',
          '',
          codeFence(judgment.nota.trim()),
          judgment.nota.trim(),
          codeFence(judgment.nota.trim()),
          '',
        ].join('\n'),
      });
    }
  }
  files.push(
    {
      path: `${rootDirectory}/README.md`,
      content: renderReadme(input, judgments, warnings),
    },
    {
      path: `${rootDirectory}/INDEX.html`,
      content: renderIndex(input, judgments, warnings),
    },
  );

  if (input.evolution) {
    files.push(
      jsonFile(`${rootDirectory}/evolucion.json`, {
        schemaVersion: 'galilei-evolution-dossier/1',
        name: input.evolution.name,
        generatedAt,
        selectedJudgmentIds: input.evolution.selectedJudgmentIds,
        chronologicalSlugs: input.evolution.chronologicalSlugs,
        relationTypes: input.evolution.relationTypes,
        verifiedCitationEdges: input.evolution.verifiedCitationEdges,
        sameExpedienteGroups: input.evolution.sameExpedienteGroups,
      }),
    );
  }

  const hashes = Object.fromEntries(
    files.map((file) => [file.path, sha256(file.content)]),
  );
  const manifest: ResearchBundleManifest = {
    schemaVersion: RESEARCH_BUNDLE_SCHEMA_VERSION,
    bundleId: randomUUID(),
    generatedAt,
    application: {
      name: 'Galilei',
      ...(input.gitSha && /^[0-9a-f]{40}$/iu.test(input.gitSha)
        ? { gitSha: input.gitSha.toLowerCase() }
        : {}),
    },
    collection,
    contents: {
      judgmentCount: judgments.length,
      noteCount: notes.length,
      filesGenerated: files.length + 1,
    },
    judgments: judgments.map((judgment) => ({
      id: judgment.id,
      numeroSentencia: judgment.numeroSentencia,
      sala: judgment.sala,
      fecha: judgment.fecha?.toISOString() ?? null,
      expediente: judgment.expediente,
      caratula: judgment.caratula,
      slugPublico: judgment.slugPublico,
      ...(judgment.textProvenance
        ? { textProvenance: judgment.textProvenance }
        : {}),
    })),
    ...(input.evolution
      ? {
          researchContext: {
            type: 'JURISPRUDENTIAL_EVOLUTION' as const,
            name: input.evolution.name,
            selectedJudgmentIds: input.evolution.selectedJudgmentIds,
            chronologicalSlugs: input.evolution.chronologicalSlugs,
            relationTypes: input.evolution.relationTypes,
          },
        }
      : {}),
    hashes,
    warnings,
  };
  files.push(jsonFile(`${rootDirectory}/manifest.json`, manifest));

  const date = generatedAt.slice(0, 10);
  return {
    rootDirectory,
    downloadFilename: `galilei-${safeCollectionSlug(input.collection.nombre, input.collection.id)}-${date}.zip`,
    manifest,
    files,
  };
}
