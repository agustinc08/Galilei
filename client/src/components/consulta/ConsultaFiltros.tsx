'use client';

import { useState } from 'react';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SearchAutocomplete } from '@/components/ui/SearchAutocomplete';
import { Select } from '@/components/ui/Select';
import type { ConsultaPublicaFilters } from '@/types/busqueda';
import { SearchHelpModal } from './SearchHelpModal';

type Props = {
  initialValues: ConsultaPublicaFilters;
  temas: string[];
  salas: string[];
  tiposFallo: string[];
  tribunalesOrigen: string[];
  onSearch: (values: ConsultaPublicaFilters) => void;
  onClear: () => void;
  onPrint: () => void;
};

export function ConsultaFiltros({
  initialValues,
  temas,
  salas,
  tiposFallo,
  tribunalesOrigen,
  onSearch,
  onClear,
  onPrint,
}: Props) {
  const [values, setValues] = useState<ConsultaPublicaFilters>(initialValues);
  const [showHelp, setShowHelp] = useState(false);

  const setField = (field: keyof ConsultaPublicaFilters, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <Card>
      <div className={styles.filtersCard}>
        <div className={styles.primarySearchRow}>
          <SearchAutocomplete
            label="Buscar jurisprudencia"
            value={values.q ?? ''}
            onChange={(nextValue) => setField('q', nextValue)}
            onSelect={(nextValue) => onSearch({ ...values, q: nextValue })}
            endpoint="/public/busqueda/sugerencias"
            skipAuth
            placeholder={'Buscar (ej: accidente moto, "daño moral", accidente -penal)'}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setShowHelp(true)}>
              ?
            </Button>
            <Button onClick={() => onSearch(values)}>Buscar</Button>
          </div>
        </div>
        <div className={styles.filtersGrid}>
          <Select
            label="Tema"
            value={values.tema ?? ''}
            onChange={(event) => setField('tema', event.target.value)}
            options={[{ label: 'Todos', value: '' }, ...temas.map((item) => ({ label: item, value: item }))]}
          />
          <Select
            label="Salas"
            value={values.sala ?? ''}
            onChange={(event) => setField('sala', event.target.value)}
            options={[{ label: 'Todas', value: '' }, ...salas.map((item) => ({ label: item, value: item }))]}
          />
          <Input label="Desde fecha" type="date" value={values.fechaDesde ?? ''} onChange={(event) => setField('fechaDesde', event.target.value)} />
          <Input label="Hasta fecha" type="date" value={values.fechaHasta ?? ''} onChange={(event) => setField('fechaHasta', event.target.value)} />
          <Select
            label="Tipo de fallo"
            value={values.tipoFallo ?? ''}
            onChange={(event) => setField('tipoFallo', event.target.value)}
            options={[{ label: 'Todos', value: '' }, ...tiposFallo.map((item) => ({ label: item, value: item }))]}
          />
          <Select
            label="Tribunal origen"
            value={values.tribunalOrigen ?? ''}
            onChange={(event) => setField('tribunalOrigen', event.target.value)}
            options={[{ label: 'Todos', value: '' }, ...tribunalesOrigen.map((item) => ({ label: item, value: item }))]}
          />
          <Input label="N° sumario" value={values.numeroSumario ?? ''} onChange={(event) => setField('numeroSumario', event.target.value)} />
          <Input label="Sentencia" value={values.numeroSentencia ?? ''} onChange={(event) => setField('numeroSentencia', event.target.value)} />
          <Input label="Magistrados" value={values.magistrados ?? ''} onChange={(event) => setField('magistrados', event.target.value)} />
          <Input label="Carátula" value={values.caratula ?? ''} onChange={(event) => setField('caratula', event.target.value)} />
          <Input label="N° expediente" value={values.expediente ?? ''} onChange={(event) => setField('expediente', event.target.value)} />
          <Select
            label="PDF"
            value={values.pdf || (values.soloConPdf === 'true' ? 'conPdf' : 'todos')}
            onChange={(event) => {
              const nextPdf = event.target.value as ConsultaPublicaFilters['pdf'];
              setValues((current) => ({
                ...current,
                pdf: nextPdf,
                soloConPdf: '',
              }));
            }}
            options={[
              { label: 'Todos', value: 'todos' },
              { label: 'Solo con PDF', value: 'conPdf' },
              { label: 'Solo sin PDF', value: 'sinPdf' },
            ]}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="secondary" onClick={onPrint}>
            Imprimir
          </Button>
          <Button variant="secondary" onClick={onClear}>
            Limpiar
          </Button>
        </div>
      </div>
      <SearchHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </Card>
  );
}
