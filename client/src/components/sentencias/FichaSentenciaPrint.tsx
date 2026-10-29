'use client';

import styles from './sentencias.module.css';
import type { FichaSentencia } from '@/types/sentencia';
import { formatDate } from '@/lib/utils';
import { htmlToPlainText } from '@/lib/html-to-plain-text';

type Props = {
  ficha: FichaSentencia;
  publicView?: boolean;
};

export function FichaSentenciaPrint({ ficha, publicView = false }: Props) {
  const caratula =
    ficha.sentencia.caratula ??
    [ficha.sentencia.actor, ficha.sentencia.demandado].filter(Boolean).join(' c/ ') ??
    '-';

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}>
      <header className={styles.section} style={{ borderBottom: '2px solid #dbe4ee', paddingBottom: 12 }}>
        <strong>Sistema Web de Consulta de Jurisprudencia</strong>
        <span>Camara Nacional de Apelaciones en lo Civil</span>
        <span>Fecha de generacion: {formatDate(ficha.generatedAt)}</span>
        <span>{publicView ? 'Ficha pública' : 'Ficha interna'}</span>
      </header>

      <section className={styles.section}>
        <h1 style={{ fontSize: 28 }}>
          {ficha.cita.citaBreve || `Sentencia #${ficha.sentencia.id}`}
        </h1>
        <div className={styles.badgeRow}>
          {ficha.sentencia.sala ? <span className={styles.badge}>{ficha.sentencia.sala}</span> : null}
          {ficha.sentencia.numeroSentencia ? (
            <span className={styles.badge}>{ficha.sentencia.numeroSentencia}</span>
          ) : null}
          <span className={styles.badge}>{formatDate(ficha.sentencia.fecha)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <strong>Datos del fallo</strong>
        <p>Expediente: {ficha.sentencia.expediente ?? '-'}</p>
        <p>Caratula: {caratula || '-'}</p>
        <p>Magistrados: {ficha.sentencia.magistrados ?? '-'}</p>
        <p>Tipo de fallo: {ficha.sentencia.tipoFallo ?? '-'}</p>
        <p>Cita: {ficha.cita.citaCompleta}</p>
      </section>

      {ficha.resumen.texto ? (
        <section className={styles.section}>
          <strong>Resumen</strong>
          <p>{htmlToPlainText(ficha.resumen.texto)}</p>
        </section>
      ) : null}

      {ficha.resena ? (
        <section className={styles.section}>
          <strong>Reseña</strong>
          <p>{ficha.resena}</p>
        </section>
      ) : null}

      <section className={styles.section}>
        <strong>Sumarios</strong>
        <div className={styles.listGrid}>
          {ficha.sumarios.map((sumario) => (
            <article key={sumario.id} className={styles.listItem}>
              <strong>{sumario.numeroSumario ?? `#${sumario.id}`} | {sumario.tema ?? 'Sin tema'}</strong>
              <p>{htmlToPlainText(sumario.texto)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <strong>Este fallo cita a</strong>
        <div className={styles.listGrid}>
          {(ficha.citasFallo ?? []).map((cita) => (
            <article key={cita.id} className={styles.listItem}>
              <strong>{cita.tipo} | {cita.referencia}</strong>
              {!publicView ? (
                <span className={styles.mutedText}>
                  {cita.confirmada ? 'Confirmada' : 'Pendiente de revision'}
                </span>
              ) : null}
              {cita.contexto ? <p>{cita.contexto}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <strong>PDFs asociados</strong>
        <div className={styles.listGrid}>
          {ficha.archivosPdf.map((archivo) => (
            <article key={archivo.id} className={styles.listItem}>
              <strong>{archivo.nombreOriginal ?? archivo.nombreArchivo}</strong>
            </article>
          ))}
        </div>
      </section>

      {(ficha.referenciasNormativas ?? []).length ? (
        <section className={styles.section}>
          <strong>Normas relacionadas</strong>
          <div className={styles.listGrid}>
            {(ficha.referenciasNormativas ?? []).map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>
                  {referencia.tipoNorma}
                  {referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}
                  {referencia.articulo ? ` art. ${referencia.articulo}` : ''}
                  {referencia.inciso ? ` inc. ${referencia.inciso}` : ''}
                </strong>
                {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {(ficha.referenciasJurisprudenciales ?? []).length ? (
        <section className={styles.section}>
          <strong>Jurisprudencia relacionada</strong>
          <div className={styles.listGrid}>
            {(ficha.referenciasJurisprudenciales ?? []).map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>{referencia.referencia}</strong>
                {referencia.textoOriginal ? <p>{referencia.textoOriginal}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {(ficha.referenciasDoctrinarias ?? []).length ? (
        <section className={styles.section}>
          <strong>Doctrina</strong>
          <div className={styles.listGrid}>
            {(ficha.referenciasDoctrinarias ?? []).map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>
                  {[referencia.autor, referencia.titulo].filter(Boolean).join(' - ') || 'Referencia doctrinaria'}
                </strong>
                <p>{[referencia.fuente, referencia.anio].filter(Boolean).join(' | ')}</p>
                {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
