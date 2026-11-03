'use client';

import styles from './consulta.module.css';
import { useEffect } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SearchHelpModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  return (
    <section
      id="search-help-panel"
      className={styles.searchHelpPanel}
      hidden={!open}
      aria-labelledby="search-help-title"
    >
      <div className={styles.searchHelpHeader}>
        <strong id="search-help-title">Consejos de búsqueda</strong>
      </div>
      <div className={`${styles.listGrid} ${styles.searchHelpList}`}>
          <div className={styles.listItem}>
            <strong>Términos sin comillas</strong>
            <span className={styles.mutedText}>responsabilidad civil busca desde el inicio de cada palabra. Por defecto, deben coincidir todos los términos.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Una palabra exacta</strong>
            <span className={styles.mutedText}>&quot;daño&quot; busca la palabra completa, no un fragmento dentro de otra palabra.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Frase exacta</strong>
            <span className={styles.mutedText}>&quot;daño moral&quot; busca las palabras en ese orden y sin términos intermedios.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Exclusión</strong>
            <span className={styles.mutedText}>daño -penal excluye resultados que contengan penal.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Operadores</strong>
            <span className={styles.mutedText}>OR o + acepta cualquiera de los términos; AND exige todos. «Coincidencia» define cómo combinar términos sin operador.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Campos</strong>
            <span className={styles.mutedText}>tema:&quot;daño moral&quot; sala:C expediente:&quot;123/2024&quot; limita la búsqueda a esos campos.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Comodín %</strong>
            <span className={styles.mutedText}>responsabilidad% busca prefijos; %civil busca finales; %civil% encuentra el fragmento en cualquier posición.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Tildes y ñ</strong>
            <span className={styles.mutedText}>Mayúsculas y minúsculas coinciden; las vocales con o sin tilde también. La ñ es distinta de la n.</span>
          </div>
          <div className={styles.listItem}>
            <strong>Filtros</strong>
            <span className={styles.mutedText}>Combiná el texto con Sala, fecha, tribunal, expediente, carátula, tipo de fallo, PDF y otros campos del formulario.</span>
          </div>
      </div>
    </section>
  );
}
