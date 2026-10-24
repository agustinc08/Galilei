import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventosConsultaService } from './eventos-consulta.service';
import { UsoStatsQueryDto } from './dto/uso-stats-query.dto';
import { sentenciaTienePdfReal } from '../archivos/pdf-real.util';

type EventoMetadata = Record<string, unknown> | null;
type CountItem = { nombre: string; total: number };
type AnnualReportData = Awaited<
  ReturnType<EstadisticasService['anual']>
>['data'];

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Injectable()
export class EstadisticasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventosConsultaService: EventosConsultaService,
  ) {}

  async resumenGeneral() {
    const [
      totalSentencias,
      totalSumarios,
      sentenciasConArchivos,
      totalPublicadas,
      totalDestacadas,
      totalConResumen,
      totalConResena,
    ] = await Promise.all([
      this.prisma.sentencia.count(),
      this.prisma.sumario.count(),
      this.prisma.sentencia.findMany({
        select: { archivosPdf: { select: { id: true, rutaArchivo: true } } },
      }),
      this.prisma.sentencia.count({ where: { publicado: true } }),
      this.prisma.sentencia.count({ where: { destacada: true } }),
      this.prisma.sentencia.count({ where: { resumenIa: { not: null } } }),
      this.prisma.sentencia.count({ where: { resena: { not: null } } }),
    ]);

    return {
      data: {
        totalSentencias,
        totalSumarios,
        totalConPdf: sentenciasConArchivos.filter(
          (item) => sentenciaTienePdfReal(item.archivosPdf).disponible,
        ).length,
        totalPublicadas,
        totalDestacadas,
        totalConResumen,
        totalConResena,
      },
    };
  }

  async porAnio() {
    const sentencias = await this.prisma.sentencia.groupBy({
      by: ['anio'],
      where: { anio: { not: null } },
      _count: { id: true },
      orderBy: { anio: 'asc' },
    });

    const sumarios = await this.prisma.sumario.groupBy({
      by: ['sentenciaId'],
      _count: { id: true },
    });

    const anioBySentencia = await this.prisma.sentencia.findMany({
      where: {
        id: { in: sumarios.map((item) => item.sentenciaId) },
        anio: { not: null },
      },
      select: { id: true, anio: true },
    });

    const map = new Map<number, number>();
    for (const item of sumarios) {
      const sentencia = anioBySentencia.find(
        (candidate) => candidate.id === item.sentenciaId,
      );
      if (!sentencia?.anio) {
        continue;
      }
      map.set(sentencia.anio, (map.get(sentencia.anio) ?? 0) + item._count.id);
    }

    return {
      data: sentencias.map((item) => ({
        anio: item.anio,
        sentencias: item._count.id,
        sumarios: map.get(item.anio ?? -1) ?? 0,
      })),
    };
  }

  async porMes() {
    const sentencias = await this.prisma.sentencia.findMany({
      select: { createdAt: true },
    });

    return {
      data: this.countByMonth(sentencias.map((item) => item.createdAt)),
    };
  }

  async porSala() {
    const data = await this.prisma.sentencia.groupBy({
      by: ['sala'],
      where: { sala: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return {
      data: data.map((item) => ({
        sala: item.sala,
        total: item._count.id,
      })),
    };
  }

  async porTipoFallo() {
    const data = await this.prisma.sentencia.groupBy({
      by: ['tipoFallo'],
      where: { tipoFallo: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return {
      data: data.map((item) => ({
        tipoFallo: item.tipoFallo,
        total: item._count.id,
      })),
    };
  }

  async porTribunalOrigen() {
    const data = await this.prisma.sentencia.groupBy({
      by: ['tribunalOrigen'],
      where: { tribunalOrigen: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return {
      data: data.map((item) => ({
        tribunalOrigen: item.tribunalOrigen,
        total: item._count.id,
      })),
    };
  }

  async porTema() {
    const data = await this.prisma.sumario.groupBy({
      by: ['tema'],
      where: { tema: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    });

    return {
      data: data.map((item) => ({
        tema: item.tema,
        total: item._count.id,
      })),
    };
  }

  async calidadDatos() {
    const [
      sentenciasSinResumen,
      sentenciasSinResena,
      sentenciasParaPdf,
      sentenciasSinSumarios,
      sentenciasSinActor,
      sentenciasSinDemandado,
      sentenciasSinObjeto,
      sumariosSinTema,
    ] = await Promise.all([
      this.prisma.sentencia.count({
        where: { OR: [{ resumenIa: null }, { resumenIa: '' }] },
      }),
      this.prisma.sentencia.count({
        where: { OR: [{ resena: null }, { resena: '' }] },
      }),
      this.prisma.sentencia.findMany({
        select: { archivosPdf: { select: { id: true, rutaArchivo: true } } },
      }),
      this.prisma.sentencia.count({ where: { sumarios: { none: {} } } }),
      this.prisma.sentencia.count({
        where: { OR: [{ actor: null }, { actor: '' }] },
      }),
      this.prisma.sentencia.count({
        where: { OR: [{ demandado: null }, { demandado: '' }] },
      }),
      this.prisma.sentencia.count({
        where: { OR: [{ objeto: null }, { objeto: '' }] },
      }),
      this.prisma.sumario.count({
        where: { OR: [{ tema: null }, { tema: '' }] },
      }),
    ]);

    return {
      data: {
        sentenciasSinResumen,
        sentenciasSinResena,
        sentenciasSinPdf: sentenciasParaPdf.filter(
          (item) => !sentenciaTienePdfReal(item.archivosPdf).disponible,
        ).length,
        sentenciasSinSumarios,
        sentenciasSinActor,
        sentenciasSinDemandado,
        sentenciasSinObjeto,
        sumariosSinTema,
      },
    };
  }

  async publicacion() {
    const [
      publicadas,
      noPublicadas,
      destacadas,
      noDestacadas,
      conResumenPublicado,
      sinResumenPublicado,
    ] = await Promise.all([
      this.prisma.sentencia.count({ where: { publicado: true } }),
      this.prisma.sentencia.count({ where: { publicado: false } }),
      this.prisma.sentencia.count({ where: { destacada: true } }),
      this.prisma.sentencia.count({ where: { destacada: false } }),
      this.prisma.sentencia.count({ where: { resumenPublicado: true } }),
      this.prisma.sentencia.count({ where: { resumenPublicado: false } }),
    ]);

    return {
      data: {
        publicadas,
        noPublicadas,
        destacadas,
        noDestacadas,
        conResumenPublicado,
        sinResumenPublicado,
      },
    };
  }

  async anual(anio = new Date().getFullYear()) {
    const year = Number.isFinite(anio) ? anio : new Date().getFullYear();
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const byCreatedAt = { gte: from, lt: to };
    const byFecha = { gte: from, lt: to };

    const [
      sentenciasCargadas,
      sentenciasFechaFallo,
      sumariosCargados,
      pdfsCargados,
      refsNormativas,
      refsJurisprudenciales,
      refsDoctrinarias,
    ] = await Promise.all([
      this.prisma.sentencia.findMany({
        where: { createdAt: byCreatedAt },
        select: {
          id: true,
          sala: true,
          tipoFallo: true,
          tribunalOrigen: true,
          createdAt: true,
          publicado: true,
          resena: true,
          anonimizado: true,
          destacada: true,
          archivosPdf: { select: { id: true, rutaArchivo: true } },
          sumarios: { select: { id: true } },
        },
      }),
      this.prisma.sentencia.findMany({
        where: { fecha: byFecha },
        select: {
          id: true,
          sala: true,
          tipoFallo: true,
          tribunalOrigen: true,
          fecha: true,
        },
      }),
      this.prisma.sumario.findMany({
        where: { createdAt: byCreatedAt },
        select: { id: true, tema: true, sentenciaId: true, createdAt: true },
      }),
      this.prisma.archivoPdf.findMany({
        where: { createdAt: byCreatedAt },
        select: { id: true, sentenciaId: true, createdAt: true },
      }),
      this.prisma.referenciaNormativa.findMany({
        where: { createdAt: byCreatedAt },
        select: { sentenciaId: true },
      }),
      this.prisma.referenciaJurisprudencial.findMany({
        where: { createdAt: byCreatedAt },
        select: { sentenciaId: true },
      }),
      this.prisma.referenciaDoctrinaria.findMany({
        where: { createdAt: byCreatedAt },
        select: { sentenciaId: true },
      }),
    ]);

    const sinPdf = sentenciasCargadas.filter(
      (item) => !sentenciaTienePdfReal(item.archivosPdf).disponible,
    ).length;
    const sinResena = sentenciasCargadas.filter(
      (item) => !item.resena?.trim(),
    ).length;
    const sinSumarios = sentenciasCargadas.filter(
      (item) => item.sumarios.length === 0,
    ).length;

    return {
      data: {
        anio: year,
        titulo: `Informe anual de carga jurisprudencial - Año ${year}`,
        generadoEn: new Date().toISOString(),
        porFechaCarga: {
          totalSentenciasCargadas: sentenciasCargadas.length,
          totalSumariosCargados: sumariosCargados.length,
          totalPdfsCargados: pdfsCargados.length,
          totalPublicadas: sentenciasCargadas.filter((item) => item.publicado)
            .length,
          totalNoPublicadas: sentenciasCargadas.filter(
            (item) => !item.publicado,
          ).length,
          totalConResena: sentenciasCargadas.filter((item) =>
            Boolean(item.resena?.trim()),
          ).length,
          totalConReferenciasNormativas: new Set(
            refsNormativas.map((item) => item.sentenciaId),
          ).size,
          totalConReferenciasJurisprudenciales: new Set(
            refsJurisprudenciales.map((item) => item.sentenciaId),
          ).size,
          totalConReferenciasDoctrinarias: new Set(
            refsDoctrinarias.map((item) => item.sentenciaId),
          ).size,
          totalAnonimizadas: sentenciasCargadas.filter(
            (item) => item.anonimizado,
          ).length,
          totalDestacadas: sentenciasCargadas.filter((item) => item.destacada)
            .length,
          calidadDatos: {
            sinPdf,
            sinResena,
            sinSumarios,
          },
        },
        porFechaFallo: {
          totalSentencias: sentenciasFechaFallo.length,
          porSala: this.countBy(sentenciasFechaFallo.map((item) => item.sala)),
          porTipoFallo: this.countBy(
            sentenciasFechaFallo.map((item) => item.tipoFallo),
          ),
          porTribunalOrigen: this.countBy(
            sentenciasFechaFallo.map((item) => item.tribunalOrigen),
          ),
        },
        porSala: this.countBy(sentenciasCargadas.map((item) => item.sala)),
        porTipoFallo: this.countBy(
          sentenciasCargadas.map((item) => item.tipoFallo),
        ),
        porTribunalOrigen: this.countBy(
          sentenciasCargadas.map((item) => item.tribunalOrigen),
        ),
        porMes: this.countByMonth(
          sentenciasCargadas.map((item) => item.createdAt),
        ),
        topTemas: this.countBy(sumariosCargados.map((item) => item.tema)).slice(
          0,
          15,
        ),
      },
    };
  }

  async exportarAnual(anio: number, formato: 'pdf' | 'docx') {
    const report = await this.anual(anio);
    if (formato === 'docx') {
      return {
        filename: `informe-anual-${report.data.anio}.docx`,
        contentType: 'application/json; charset=utf-8',
        buffer: Buffer.from(
          JSON.stringify({
            message:
              'La exportación DOCX queda documentada para una siguiente etapa. Use formato=pdf para descargar el informe anual.',
          }),
          'utf8',
        ),
        notImplemented: true,
      };
    }

    return {
      filename: `informe-anual-${report.data.anio}.pdf`,
      contentType: 'application/pdf',
      buffer: this.buildAnnualPdf(report.data),
      notImplemented: false,
    };
  }

  async usoBusquedas(query?: UsoStatsQueryDto) {
    const data = await this.eventosConsultaService.groupedByTipo(
      'search_',
      query,
    );
    return { data };
  }

  async sentenciasMasVistas(query?: UsoStatsQueryDto) {
    return {
      data: await this.eventosConsultaService.topSentenciasByEvent(
        'view_sentencia',
        10,
        query,
      ),
    };
  }

  async descargasPdf(query?: UsoStatsQueryDto) {
    return {
      data: await this.eventosConsultaService.topSentenciasByEvent(
        'download_pdf',
        10,
        query,
      ),
    };
  }

  async favoritos(query?: UsoStatsQueryDto) {
    const data = await this.eventosConsultaService.groupedByTipo(
      'favorite_',
      query,
    );
    return { data };
  }

  async compartidos(query?: UsoStatsQueryDto) {
    const data = await this.eventosConsultaService.groupedByTipo(
      'share_',
      query,
    );
    return { data };
  }

  async usoResumen(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const searchPublic = eventos.filter(
      (item) => item.tipoEvento === 'search_public',
    );
    const searchInternal = eventos.filter(
      (item) => item.tipoEvento === 'search_internal',
    );
    const sinResultados = eventos.filter(
      (item) =>
        item.tipoEvento.startsWith('search_') &&
        this.readNumber(item.metadata, 'cantidadResultados', 'total') === 0,
    );

    return {
      data: {
        busquedasPublicas: searchPublic.length,
        busquedasInternas: searchInternal.length,
        busquedasSinResultados: sinResultados.length,
        sugerenciasClickeadas: eventos.filter(
          (item) => item.tipoEvento === 'suggestion_click',
        ).length,
        impresionesResultados: eventos.filter(
          (item) => item.tipoEvento === 'print_result',
        ).length,
        impresionesFicha: eventos.filter(
          (item) => item.tipoEvento === 'print_ficha',
        ).length,
        exportaciones: eventos.filter(
          (item) => item.tipoEvento === 'export_results',
        ).length,
        vistasDocumento: eventos.filter(
          (item) => item.tipoEvento === 'view_documento',
        ).length,
      },
    };
  }

  async busquedasPopulares(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const counter = new Map<string, number>();

    for (const item of eventos) {
      if (!item.tipoEvento.startsWith('search_')) {
        continue;
      }

      const raw = this.readString(item.metadata, 'query', 'q');
      const value = raw?.trim();
      if (!value) {
        continue;
      }
      counter.set(value, (counter.get(value) ?? 0) + 1);
    }

    return {
      data: [...counter.entries()]
        .map(([termino, total]) => ({ termino, total }))
        .sort(
          (left, right) =>
            right.total - left.total ||
            left.termino.localeCompare(right.termino),
        )
        .slice(0, 15),
    };
  }

  async busquedasSinResultados(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const counter = new Map<string, number>();

    for (const item of eventos) {
      if (!item.tipoEvento.startsWith('search_')) {
        continue;
      }
      const total = this.readNumber(
        item.metadata,
        'cantidadResultados',
        'total',
      );
      if (total !== 0) {
        continue;
      }
      const value = this.readString(item.metadata, 'query', 'q')?.trim();
      if (!value) {
        continue;
      }
      counter.set(value, (counter.get(value) ?? 0) + 1);
    }

    return {
      data: [...counter.entries()]
        .map(([termino, total]) => ({ termino, total }))
        .sort(
          (left, right) =>
            right.total - left.total ||
            left.termino.localeCompare(right.termino),
        )
        .slice(0, 15),
    };
  }

  async filtrosMasUsados(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const counter = new Map<string, number>();

    for (const item of eventos) {
      if (!item.tipoEvento.startsWith('search_')) {
        continue;
      }
      const filtros = this.readObject(
        item.metadata,
        'filtrosUsados',
        'filtersUsed',
      );
      if (!filtros) {
        continue;
      }

      for (const [key, value] of Object.entries(filtros)) {
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          value === false
        ) {
          continue;
        }
        counter.set(key, (counter.get(key) ?? 0) + 1);
      }
    }

    return {
      data: [...counter.entries()]
        .map(([filtro, total]) => ({ filtro, total }))
        .sort(
          (left, right) =>
            right.total - left.total || left.filtro.localeCompare(right.filtro),
        )
        .slice(0, 20),
    };
  }

  async sugerenciasClicks(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const counter = new Map<string, number>();

    for (const item of eventos) {
      if (item.tipoEvento !== 'suggestion_click') {
        continue;
      }
      const value = this.readString(
        item.metadata,
        'value',
        'suggestion',
      )?.trim();
      if (!value) {
        continue;
      }
      counter.set(value, (counter.get(value) ?? 0) + 1);
    }

    return {
      data: [...counter.entries()]
        .map(([termino, total]) => ({ termino, total }))
        .sort(
          (left, right) =>
            right.total - left.total ||
            left.termino.localeCompare(right.termino),
        )
        .slice(0, 15),
    };
  }

  async documentosMasConsultados(query?: UsoStatsQueryDto) {
    return {
      data: await this.eventosConsultaService.topSentenciasByEvent(
        'view_documento',
        10,
        query,
      ),
    };
  }

  async documentosMasDescargados(query?: UsoStatsQueryDto) {
    return {
      data: await this.eventosConsultaService.topSentenciasByEvent(
        'download_pdf',
        10,
        query,
      ),
    };
  }

  async actividadPorDia(query?: UsoStatsQueryDto) {
    const eventos = await this.eventosConsultaService.getEventos(query);
    const counter = new Map<string, number>();

    for (const item of eventos) {
      const day = item.createdAt.toISOString().slice(0, 10);
      counter.set(day, (counter.get(day) ?? 0) + 1);
    }

    return {
      data: [...counter.entries()]
        .map(([fecha, total]) => ({ fecha, total }))
        .sort((left, right) => left.fecha.localeCompare(right.fecha)),
    };
  }

  private readString(metadata: EventoMetadata, ...keys: string[]) {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return null;
  }

  private readNumber(metadata: EventoMetadata, ...keys: string[]) {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'number') {
        return value;
      }
    }
    return null;
  }

  private readObject(metadata: EventoMetadata, ...keys: string[]) {
    for (const key of keys) {
      const value = metadata?.[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return null;
  }

  private countBy(values: Array<string | null | undefined>): CountItem[] {
    const counter = new Map<string, number>();
    for (const value of values) {
      const key = value?.trim() || 'Sin informar';
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    return [...counter.entries()]
      .map(([nombre, total]) => ({ nombre, total }))
      .sort(
        (left, right) =>
          right.total - left.total || left.nombre.localeCompare(right.nombre),
      );
  }

  private countByMonth(values: Date[]) {
    const counter = new Map<number, number>();
    for (let month = 0; month < 12; month += 1) {
      counter.set(month, 0);
    }
    for (const value of values) {
      const month = value.getUTCMonth();
      counter.set(month, (counter.get(month) ?? 0) + 1);
    }
    return [...counter.entries()].map(([month, total]) => ({
      mes: month + 1,
      nombre: MONTH_LABELS[month],
      total,
    }));
  }

  private buildAnnualPdf(data: AnnualReportData) {
    const lines = [
      data.titulo,
      'Cámara Nacional de Apelaciones en lo Civil',
      'Secretaría de Documentación y Jurisprudencia',
      '',
      `Fecha de generación: ${new Date(data.generadoEn).toLocaleString('es-AR')}`,
      '',
      'Resumen general',
      `Sentencias cargadas: ${data.porFechaCarga.totalSentenciasCargadas}`,
      `Sumarios cargados: ${data.porFechaCarga.totalSumariosCargados}`,
      `PDFs cargados: ${data.porFechaCarga.totalPdfsCargados}`,
      `Publicadas: ${data.porFechaCarga.totalPublicadas}`,
      `No publicadas: ${data.porFechaCarga.totalNoPublicadas}`,
      `Con reseña: ${data.porFechaCarga.totalConResena}`,
      `Anonimizadas: ${data.porFechaCarga.totalAnonimizadas}`,
      `Destacadas: ${data.porFechaCarga.totalDestacadas}`,
      '',
      'Calidad de datos',
      `Sin PDF: ${data.porFechaCarga.calidadDatos.sinPdf}`,
      `Sin reseña: ${data.porFechaCarga.calidadDatos.sinResena}`,
      `Sin sumarios: ${data.porFechaCarga.calidadDatos.sinSumarios}`,
      '',
      'Por sala',
      ...this.formatItems(data.porSala),
      '',
      'Por tipo de fallo',
      ...this.formatItems(data.porTipoFallo),
      '',
      'Por tribunal de origen',
      ...this.formatItems(data.porTribunalOrigen),
      '',
      'Por mes',
      ...data.porMes.map((item) => `${item.nombre}: ${item.total}`),
      '',
      'Top temas',
      ...this.formatItems(data.topTemas),
      '',
      'Fallos con fecha del año',
      `Total: ${data.porFechaFallo.totalSentencias}`,
    ];

    return this.createSimplePdf(lines);
  }

  private formatItems(items: CountItem[]) {
    return items.length
      ? items.map((item) => `${item.nombre}: ${item.total}`)
      : ['Sin datos'];
  }

  private createSimplePdf(lines: string[]) {
    const escapedLines = lines.map((line) =>
      line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'),
    );
    const content = [
      'BT',
      '/F1 11 Tf',
      '48 800 Td',
      '14 TL',
      ...escapedLines.flatMap((line, index) => [
        index === 0 ? '' : 'T*',
        `(${line}) Tj`,
      ]),
      'ET',
    ]
      .filter(Boolean)
      .join('\n');

    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
      `5 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += object;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (const offset of offsets.slice(1)) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }
}
