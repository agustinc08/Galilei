'use client';

import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  selectedCount: number;
  onPrint: () => void;
  onClear: () => void;
};

export function SelectedResultsBar({ selectedCount, onPrint, onClear }: Props) {
  return (
    <div className={styles.selectedBar}>
      <strong>Seleccionados: {selectedCount}</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={onPrint}>
          Imprimir seleccionados
        </Button>
        <Button variant="ghost" onClick={onClear} disabled={selectedCount === 0}>
          Limpiar seleccion
        </Button>
      </div>
    </div>
  );
}
