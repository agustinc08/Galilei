'use client';

import { useEffect } from 'react';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { HighlightText } from './HighlightText';
import type { ConsultaPublicaResultado } from '@/types/busqueda';
import { formatDate } from '@/lib/utils';

type Props = {
  items: ConsultaPublicaResultado[];
};

export function ConsultaPrintView({ items }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className={styles.printPage}>
      <div className={`${styles.printHeader} ${styles.noPrint}`}>
        <Button variant="secondary" onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>

      <header className={styles.printHeader}>
        <strong>Sistema Web de Consulta de Jurisprudencia</strong>
        <span>Camara Nacional de Apelaciones en lo Civil</span>
        <span>Fecha de impresion: {new Date().toLocaleString('es-AR')}</span>
      </header>

      {items.map((item) => (
        <article key={item.id} className={styles.printItem}>
          <strong>
            {item.numeroSumario ?? `#${item.id}`} | {item.tema ?? 'Sin tema'}
          </strong>
          <span>
            Sentencia: {item.numeroSentencia ?? '-'} | Sala: {item.sala ?? '-'} |
            Fecha: {formatDate(item.fecha)}
          </span>
          <span>Magistrados: {item.magistrados ?? '-'}</span>
          <span>Caratula: {item.caratula ?? '-'}</span>
          <span>Expediente: {item.expediente ?? '-'}</span>
          <p>{item.textoSumario}</p>
          {item.highlights[0] ? <HighlightText html={item.highlights[0].texto} /> : null}
        </article>
      ))}
    </main>
  );
}
