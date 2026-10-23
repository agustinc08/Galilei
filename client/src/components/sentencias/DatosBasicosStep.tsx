'use client';

import styles from './sentencias.module.css';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import type { CatalogoItem } from '@/types/catalogos';
import type { SentenciaFormValues } from '@/types/sentencia';

type Props = {
  values: SentenciaFormValues;
  salas?: CatalogoItem[];
  tiposFallo?: CatalogoItem[];
  tribunalesOrigen?: CatalogoItem[];
  onChange: <K extends keyof SentenciaFormValues>(
    key: K,
    value: SentenciaFormValues[K],
  ) => void;
};

export function DatosBasicosStep({
  values,
  salas = [],
  tiposFallo = [],
  tribunalesOrigen = [],
  onChange,
}: Props) {
  return (
    <div className={styles.section}>
      <div className={styles.formGrid}>
        <Input label="N° de sentencia" value={values.numeroSentencia} onChange={(event) => onChange('numeroSentencia', event.target.value)} />
        <Input label="Fecha" type="date" value={values.fecha} onChange={(event) => onChange('fecha', event.target.value)} />
        {salas.length > 0 ? (
          <Select
            label="Sala"
            value={String(values.salaId || '')}
            options={[
              { label: 'Seleccionar sala', value: '' },
              ...salas.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = salas.find((item) => item.id === Number(event.target.value));
              onChange('salaId', event.target.value ? Number(event.target.value) : '');
              onChange('sala', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input label="Sala" value={values.sala} onChange={(event) => onChange('sala', event.target.value)} />
        )}
        {tiposFallo.length > 0 ? (
          <Select
            label="Tipo de fallo"
            value={String(values.tipoFalloId || '')}
            options={[
              { label: 'Seleccionar tipo', value: '' },
              ...tiposFallo.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = tiposFallo.find((item) => item.id === Number(event.target.value));
              onChange('tipoFalloId', event.target.value ? Number(event.target.value) : '');
              onChange('tipoFallo', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input label="Tipo de fallo" value={values.tipoFallo} onChange={(event) => onChange('tipoFallo', event.target.value)} />
        )}
        <Input label="Expediente" value={values.expediente} onChange={(event) => onChange('expediente', event.target.value)} />
        {tribunalesOrigen.length > 0 ? (
          <Select
            label="Tribunal de origen"
            value={String(values.tribunalOrigenId || '')}
            options={[
              { label: 'Seleccionar tribunal', value: '' },
              ...tribunalesOrigen.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = tribunalesOrigen.find((item) => item.id === Number(event.target.value));
              onChange('tribunalOrigenId', event.target.value ? Number(event.target.value) : '');
              onChange('tribunalOrigen', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input label="Tribunal de origen" value={values.tribunalOrigen} onChange={(event) => onChange('tribunalOrigen', event.target.value)} />
        )}
        <Input label="Caratula" value={values.caratula} onChange={(event) => onChange('caratula', event.target.value)} />
        <Input label="Actor" value={values.actor} onChange={(event) => onChange('actor', event.target.value)} />
        <Input label="Demandado" value={values.demandado} onChange={(event) => onChange('demandado', event.target.value)} />
        <Input label="Magistrados" value={values.magistrados} onChange={(event) => onChange('magistrados', event.target.value)} />
      </div>
      <Textarea label="Objeto" value={values.objeto} onChange={(event) => onChange('objeto', event.target.value)} />
      <Textarea
        label="Observaciones internas"
        value={values.observacionesInternas}
        onChange={(event) => onChange('observacionesInternas', event.target.value)}
      />
    </div>
  );
}
