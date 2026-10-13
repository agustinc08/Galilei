'use client';

import { useState } from 'react';
import consultaStyles from '@/components/consulta/consulta.module.css';
import sentenciaStyles from '@/components/sentencias/sentencias.module.css';
import { SearchHelpModal } from '@/components/consulta/SearchHelpModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { Input } from '@/components/ui/Input';
import { SearchAutocomplete } from '@/components/ui/SearchAutocomplete';
import { Select } from '@/components/ui/Select';
import type { BusquedaAvanzadaFilters, ConsultaPublicaFilters } from '@/types/busqueda';

export type BusquedaJurisprudenciaValores = BusquedaAvanzadaFilters & ConsultaPublicaFilters;

type Props = {
  modo: 'publico' | 'admin';
  valoresIniciales: BusquedaJurisprudenciaValores;
  onBuscar: (values: BusquedaJurisprudenciaValores) => void;
  onLimpiar?: () => void;
  onGuardarBusqueda?: () => void;
  onExportar?: (format: string) => void | Promise<void>;
  onImprimir?: () => void;
  mostrarFiltrosInternos?: boolean;
  mostrarExportar?: boolean;
  mostrarGuardarBusqueda?: boolean;
  temas?: string[];
  salas?: string[];
  tiposFallo?: string[];
  tribunalesOrigen?: string[];
};

const pdfOptions = [
  { label: 'Todos', value: 'todos' },
  { label: 'Solo con PDF', value: 'conPdf' },
  { label: 'Solo sin PDF', value: 'sinPdf' },
];

const buscarEnOptions = [
  { label: 'Todo', value: 'todo' },
  { label: 'Sentencia', value: 'sentencia' },
  { label: 'Sumario', value: 'sumario' },
  { label: 'Reseña', value: 'resena' },
  { label: 'Referencias', value: 'referencias' },
];

export function BusquedaJurisprudenciaForm({
  modo,
  valoresIniciales,
  onBuscar,
  onLimpiar,
  onGuardarBusqueda,
  onExportar,
  onImprimir,
  mostrarFiltrosInternos = modo === 'admin',
  mostrarExportar = modo === 'admin',
  mostrarGuardarBusqueda = modo === 'admin',
  temas = [],
  salas = [],
  tiposFallo = [],
  tribunalesOrigen = [],
}: Props) {
  const [values, setValues] = useState<BusquedaJurisprudenciaValores>(valoresIniciales);
  const [showAdvanced, setShowAdvanced] = useState(modo === 'admin');
  const [showHelp, setShowHelp] = useState(false);
  const publicMode = modo === 'publico';

  const setField = (field: keyof BusquedaJurisprudenciaValores, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const suggestionBase = publicMode ? '/public/busqueda' : '/busqueda';
  const autocompleteSkipAuth = publicMode;

  const submit = () => {
    onBuscar({
      ...values,
      pdf: values.pdf || 'todos',
      soloConPdf: '',
      operador: values.operador || 'AND',
      buscarEn: values.buscarEn || 'todo',
    });
  };

  return (
    <Card>
      <div className={consultaStyles.filtersCard}>
        <div className={consultaStyles.primarySearchRow}>
          <SearchAutocomplete
            label="Buscar en jurisprudencia y documentos"
            value={values.q ?? ''}
            onChange={(nextValue) => setField('q', nextValue)}
            onSelect={(nextValue) => onBuscar({ ...values, q: nextValue, page: 1 })}
            endpoint={`${suggestionBase}/sugerencias`}
            skipAuth={autocompleteSkipAuth}
            placeholder={'Buscar en jurisprudencia y documentos...'}
          />
          <div className={sentenciaStyles.inlineActions}>
            <Button variant="secondary" onClick={() => setShowHelp(true)}>
              Ayuda
            </Button>
            {publicMode ? (
              <Button variant="secondary" onClick={() => setShowAdvanced((current) => !current)}>
                {showAdvanced ? 'Menos filtros' : 'Más filtros'}
              </Button>
            ) : null}
            <Button onClick={submit}>Buscar</Button>
          </div>
        </div>

        {showAdvanced ? (
          <div className={consultaStyles.filtersGrid}>
            <Input label="Frase exacta" value={values.fraseExacta ?? ''} onChange={(event) => setField('fraseExacta', event.target.value)} />
            <Input label="Excluir" value={values.excluir ?? ''} onChange={(event) => setField('excluir', event.target.value)} />
            <Select label="Operador" value={values.operador ?? 'AND'} onChange={(event) => setField('operador', event.target.value)} options={[{ label: 'AND', value: 'AND' }, { label: 'OR', value: 'OR' }]} />
            <Select label="Buscar en" value={values.buscarEn ?? 'todo'} onChange={(event) => setField('buscarEn', event.target.value)} options={buscarEnOptions} />
            <Select label="Tema" value={values.tema ?? ''} onChange={(event) => setField('tema', event.target.value)} options={[{ label: 'Todos', value: '' }, ...temas.map((item) => ({ label: item, value: item }))]} />
            <Select label="Sala" value={values.sala ?? ''} onChange={(event) => setField('sala', event.target.value)} options={[{ label: 'Todas', value: '' }, ...salas.map((item) => ({ label: item, value: item }))]} />
            <Select label="Tipo de fallo" value={values.tipoFallo ?? ''} onChange={(event) => setField('tipoFallo', event.target.value)} options={[{ label: 'Todos', value: '' }, ...tiposFallo.map((item) => ({ label: item, value: item }))]} />
            <Select label="Tribunal origen" value={values.tribunalOrigen ?? ''} onChange={(event) => setField('tribunalOrigen', event.target.value)} options={[{ label: 'Todos', value: '' }, ...tribunalesOrigen.map((item) => ({ label: item, value: item }))]} />
            <Input label="Magistrados" value={values.magistrados ?? ''} onChange={(event) => setField('magistrados', event.target.value)} />
            <Input label="Expediente" value={values.expediente ?? ''} onChange={(event) => setField('expediente', event.target.value)} />
            <Input label="Carátula" value={values.caratula ?? ''} onChange={(event) => setField('caratula', event.target.value)} />
            <Input label="Actor" value={values.actor ?? ''} onChange={(event) => setField('actor', event.target.value)} />
            <Input label="Demandado" value={values.demandado ?? ''} onChange={(event) => setField('demandado', event.target.value)} />
            <Input label="Objeto" value={values.objeto ?? ''} onChange={(event) => setField('objeto', event.target.value)} />
            <Input label="N° sentencia" value={values.numeroSentencia ?? ''} onChange={(event) => setField('numeroSentencia', event.target.value)} />
            <Input label="N° sumario" value={values.numeroSumario ?? ''} onChange={(event) => setField('numeroSumario', event.target.value)} />
            <Input label="Fecha desde" type="date" value={values.fechaDesde ?? ''} onChange={(event) => setField('fechaDesde', event.target.value)} />
            <Input label="Fecha hasta" type="date" value={values.fechaHasta ?? ''} onChange={(event) => setField('fechaHasta', event.target.value)} />
            <Input label="Año" value={values.anio ?? ''} onChange={(event) => setField('anio', event.target.value)} />
            <Select label="PDF" value={values.pdf || (values.soloConPdf === 'true' ? 'conPdf' : 'todos')} onChange={(event) => setField('pdf', event.target.value)} options={pdfOptions} />
            <Select label="Orden" value={values.sortBy ?? 'relevancia'} onChange={(event) => setField('sortBy', event.target.value)} options={[{ label: 'Relevancia', value: 'relevancia' }, { label: 'Fecha', value: 'fecha' }, { label: 'Sala', value: 'sala' }, { label: 'Número sentencia', value: 'numeroSentencia' }]} />
            <Select label="Sentido" value={values.sortOrder ?? 'desc'} onChange={(event) => setField('sortOrder', event.target.value)} options={[{ label: 'Desc', value: 'desc' }, { label: 'Asc', value: 'asc' }]} />
            {mostrarFiltrosInternos ? (
              <>
                <Select label="Publicado" value={values.publicado ?? ''} onChange={(event) => setField('publicado', event.target.value)} options={[{ label: 'Todos', value: '' }, { label: 'Publicado', value: 'true' }, { label: 'No publicado', value: 'false' }]} />
                <Select label="Activo" value={values.activo ?? ''} onChange={(event) => setField('activo', event.target.value)} options={[{ label: 'Todos', value: '' }, { label: 'Activo', value: 'true' }, { label: 'Inactivo', value: 'false' }]} />
                <Select label="Destacada" value={values.destacada ?? ''} onChange={(event) => setField('destacada', event.target.value)} options={[{ label: 'Todas', value: '' }, { label: 'Destacadas', value: 'true' }]} />
              </>
            ) : null}
          </div>
        ) : null}

        <div className={sentenciaStyles.inlineActions}>
          {onImprimir ? <Button variant="secondary" onClick={onImprimir}>Imprimir</Button> : null}
          {mostrarGuardarBusqueda && onGuardarBusqueda ? <Button variant="secondary" onClick={onGuardarBusqueda}>Guardar búsqueda</Button> : null}
          {mostrarExportar && onExportar ? <ExportMenu onExport={onExportar} /> : null}
          {onLimpiar ? <Button variant="secondary" onClick={onLimpiar}>Limpiar</Button> : null}
        </div>
      </div>
      <SearchHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </Card>
  );
}
