'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SentenciaFilters } from '@/types/sentencia';

type Props = {
  filters: SentenciaFilters;
  onChange: (next: SentenciaFilters) => void;
  onSubmit: () => void;
  onClear: () => void;
};

const booleanOptions = [
  { label: 'Todos', value: '' },
  { label: 'Sí', value: 'true' },
  { label: 'No', value: 'false' },
];

export function SentenciasFilters({
  filters,
  onChange,
  onSubmit,
  onClear,
}: Props) {
  const update = (key: keyof SentenciaFilters, value: string) => {
    onChange({ ...filters, [key]: value, page: 1 });
  };

  return (
    <div className={styles.section}>
      <div className={styles.filtersGrid}>
        <Input label="Número sentencia" value={filters.numeroSentencia ?? ''} onChange={(event) => update('numeroSentencia', event.target.value)} />
        <Input label="Expediente" value={filters.expediente ?? ''} onChange={(event) => update('expediente', event.target.value)} />
        <Input label="Sala" value={filters.sala ?? ''} onChange={(event) => update('sala', event.target.value)} />
        <Input label="Tipo fallo" value={filters.tipoFallo ?? ''} onChange={(event) => update('tipoFallo', event.target.value)} />
        <Input label="Actor" value={filters.actor ?? ''} onChange={(event) => update('actor', event.target.value)} />
        <Input label="Demandado" value={filters.demandado ?? ''} onChange={(event) => update('demandado', event.target.value)} />
        <Input label="Fecha desde" type="date" value={filters.fechaDesde ?? ''} onChange={(event) => update('fechaDesde', event.target.value)} />
        <Input label="Fecha hasta" type="date" value={filters.fechaHasta ?? ''} onChange={(event) => update('fechaHasta', event.target.value)} />
        <Select label="Publicada" value={filters.publicado ?? ''} onChange={(event) => update('publicado', event.target.value)} options={booleanOptions} />
        <Select label="Activa" value={filters.activo ?? ''} onChange={(event) => update('activo', event.target.value)} options={booleanOptions} />
      </div>

      <div className={styles.inlineActions}>
        <Button onClick={onSubmit}>Buscar</Button>
        <Button variant="secondary" onClick={onClear}>Limpiar filtros</Button>
      </div>
    </div>
  );
}
