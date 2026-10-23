'use client';

import styles from './wizard.module.css';
import baseStyles from './sentencias.module.css';
import type { WizardDraftSnapshot } from './wizard-types';

type Props = {
  snapshot: WizardDraftSnapshot;
};

export function VistaPreviaStep({ snapshot }: Props) {
  const sentencia = snapshot.sentencia;

  return (
    <div className={baseStyles.section}>
      <div className={styles.previewGrid}>
        <article className={styles.previewItem}>
          <span>Número</span>
          <strong>{sentencia.numeroSentencia || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Fecha</span>
          <strong>{sentencia.fecha || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Sala</span>
          <strong>{sentencia.sala || '-'}</strong>
        </article>
        <article className={styles.previewItem}>
          <span>Estado</span>
          <strong>{sentencia.estadoCarga}</strong>
        </article>
      </div>

      <div className={styles.summaryBlock}>
        <strong>Datos del fallo</strong>
        <span>Carátula: {sentencia.caratula || '-'}</span>
        <span>Expediente: {sentencia.expediente || '-'}</span>
        <span>Tribunal de origen: {sentencia.tribunalOrigen || '-'}</span>
        <span>Magistrados: {sentencia.magistrados || '-'}</span>
      </div>

      <div className={styles.summaryBlock}>
        <strong>PDF</strong>
        <span>
          {snapshot.pdfFile
            ? `Listo para subir: ${snapshot.pdfFile.name}`
            : snapshot.archivos.length
              ? `${snapshot.archivos.length} PDF asociado(s) al borrador`
              : 'Sin PDF'}
        </span>
      </div>

      <div className={styles.summaryBlock}>
        <strong>Sumarios</strong>
        <span>{snapshot.sumarios.length} preparados</span>
      </div>

      <div className={styles.summaryBlock}>
        <strong>Reseña</strong>
        <span>{snapshot.resena ? 'Con reseña cargada' : 'Sin reseña'}</span>
      </div>

      <div className={styles.summaryBlock}>
        <strong>Referencias</strong>
        <span>Normativas: {snapshot.referenciasNormativas.length}</span>
        <span>Jurisprudenciales: {snapshot.referenciasJurisprudenciales.length}</span>
        <span>Doctrinarias: {snapshot.referenciasDoctrinarias.length}</span>
      </div>

      <div className={styles.summaryBlock}>
        <strong>Publicación y anonimización</strong>
        <span>Publicar sentencia: {snapshot.opciones.publicarSentencia ? 'Sí' : 'No'}</span>
        <span>Publicar sumarios: {snapshot.opciones.publicarSumarios ? 'Sí' : 'No'}</span>
        <span>Publicar reseña: {snapshot.opciones.publicarResena ? 'Sí' : 'No'}</span>
        <span>Anonimizar: {snapshot.opciones.anonimizar ? 'Sí' : 'No'}</span>
        <span>Generar enlace público: {snapshot.opciones.generarSlugPublico ? 'Sí' : 'No'}</span>
        <span>Destacada: {snapshot.opciones.destacada ? 'Sí' : 'No'}</span>
      </div>
    </div>
  );
}
