'use client';

import { formatDate } from '@/lib/utils';
import styles from './documento.module.css';
import type { Sentencia } from '@/types/sentencia';

type Props = {
  sentencia: Partial<Sentencia>;
};

export function DocumentoMasInfoSection({ sentencia }: Props) {
  const caratula =
    [sentencia.actor, sentencia.demandado].filter(Boolean).join(' c/ ') || '-';

  return (
    <div className={styles.gridTwo}>
      <div className={styles.metaItem}>
        <strong>Sala</strong>
        <span>{sentencia.sala ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Tipo de fallo</strong>
        <span>{sentencia.tipoFallo ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Fecha</strong>
        <span>{formatDate(sentencia.fecha)}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Expediente</strong>
        <span>{sentencia.expediente ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Caratula</strong>
        <span>{caratula}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Objeto</strong>
        <span>{sentencia.objeto ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Magistrados</strong>
        <span>{sentencia.magistrados ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Enlace público</strong>
        <span>{sentencia.slugPublico ?? '-'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Publicado</strong>
        <span>{sentencia.publicado ? 'Sí' : 'No'}</span>
      </div>
      <div className={styles.metaItem}>
        <strong>Anonimizado</strong>
        <span>{sentencia.anonimizado ? 'Sí' : 'No'}</span>
      </div>
    </div>
  );
}
