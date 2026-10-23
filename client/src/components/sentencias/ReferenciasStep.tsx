'use client';

import { useMemo, useState } from 'react';
import styles from './wizard.module.css';
import baseStyles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { generateLocalId } from '@/lib/local-id';
import type {
  WizardReferenciaDoctrinariaItem,
  WizardReferenciaJurisprudencialItem,
  WizardReferenciaNormativaItem,
} from './wizard-types';

type Props = {
  normativas: WizardReferenciaNormativaItem[];
  jurisprudenciales: WizardReferenciaJurisprudencialItem[];
  doctrinarias: WizardReferenciaDoctrinariaItem[];
  onNormativasChange: (items: WizardReferenciaNormativaItem[]) => void;
  onJurisprudencialesChange: (
    items: WizardReferenciaJurisprudencialItem[],
  ) => void;
  onDoctrinariasChange: (items: WizardReferenciaDoctrinariaItem[]) => void;
};

type TabKey = 'normativas' | 'jurisprudenciales' | 'doctrinarias';

const createNormativa = (): WizardReferenciaNormativaItem => ({
  localId: generateLocalId(),
  tipoNorma: '',
  numeroNorma: '',
  articulo: '',
  inciso: '',
  textoReferencia: '',
  url: '',
});

const createJurisprudencial = (): WizardReferenciaJurisprudencialItem => ({
  localId: generateLocalId(),
  referencia: '',
  falloRelacionadoId: '',
  textoOriginal: '',
});

const createDoctrinaria = (): WizardReferenciaDoctrinariaItem => ({
  localId: generateLocalId(),
  autor: '',
  titulo: '',
  fuente: '',
  anio: '',
  textoReferencia: '',
  url: '',
});

export function ReferenciasStep({
  normativas,
  jurisprudenciales,
  doctrinarias,
  onNormativasChange,
  onJurisprudencialesChange,
  onDoctrinariasChange,
}: Props) {
  const [tab, setTab] = useState<TabKey>('normativas');
  const [normativa, setNormativa] = useState(createNormativa);
  const [jurisprudencial, setJurisprudencial] = useState(createJurisprudencial);
  const [doctrinaria, setDoctrinaria] = useState(createDoctrinaria);

  const activeCount = useMemo(
    () => ({
      normativas: normativas.length,
      jurisprudenciales: jurisprudenciales.length,
      doctrinarias: doctrinarias.length,
    }),
    [doctrinarias.length, jurisprudenciales.length, normativas.length],
  );

  const renderNormativas = () => (
    <div className={baseStyles.section}>
      <div className={baseStyles.formGrid}>
        <Input label="Tipo de norma" value={normativa.tipoNorma} onChange={(event) => setNormativa((current) => ({ ...current, tipoNorma: event.target.value }))} />
        <Input label="N° de norma" value={normativa.numeroNorma} onChange={(event) => setNormativa((current) => ({ ...current, numeroNorma: event.target.value }))} />
        <Input label="Articulo" value={normativa.articulo} onChange={(event) => setNormativa((current) => ({ ...current, articulo: event.target.value }))} />
        <Input label="Inciso" value={normativa.inciso} onChange={(event) => setNormativa((current) => ({ ...current, inciso: event.target.value }))} />
        <Input label="URL" value={normativa.url} onChange={(event) => setNormativa((current) => ({ ...current, url: event.target.value }))} />
      </div>
      <Textarea label="Texto de referencia" value={normativa.textoReferencia} onChange={(event) => setNormativa((current) => ({ ...current, textoReferencia: event.target.value }))} />
      <Button
        onClick={() => {
          if (!normativa.tipoNorma.trim()) return;
          onNormativasChange([...normativas, normativa]);
          setNormativa(createNormativa());
        }}
      >
        Agregar referencia normativa
      </Button>
      {normativas.length === 0 ? (
        <EmptyState title="Sin normas relacionadas" description="Agrega articulos o normas vinculadas." />
      ) : (
        <div className={styles.list}>
          {normativas.map((item) => (
            <article key={item.localId} className={styles.listItem}>
              <strong>
                {item.tipoNorma}
                {item.numeroNorma ? ` ${item.numeroNorma}` : ''}
                {item.articulo ? ` art. ${item.articulo}` : ''}
                {item.inciso ? ` inc. ${item.inciso}` : ''}
              </strong>
              {item.textoReferencia ? <p>{item.textoReferencia}</p> : null}
              <div className={baseStyles.inlineActions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNormativa(item);
                    onNormativasChange(
                      normativas.filter((current) => current.localId !== item.localId),
                    );
                  }}
                >
                  Editar
                </Button>
                <Button variant="danger" onClick={() => onNormativasChange(normativas.filter((current) => current.localId !== item.localId))}>
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  const renderJurisprudenciales = () => (
    <div className={baseStyles.section}>
      <div className={baseStyles.formGrid}>
        <Input label="Referencia" value={jurisprudencial.referencia} onChange={(event) => setJurisprudencial((current) => ({ ...current, referencia: event.target.value }))} />
        <Input label="Fallo relacionado ID" value={jurisprudencial.falloRelacionadoId} onChange={(event) => setJurisprudencial((current) => ({ ...current, falloRelacionadoId: event.target.value }))} />
      </div>
      <Textarea label="Texto original" value={jurisprudencial.textoOriginal} onChange={(event) => setJurisprudencial((current) => ({ ...current, textoOriginal: event.target.value }))} />
      <Button
        onClick={() => {
          if (!jurisprudencial.referencia.trim()) return;
          onJurisprudencialesChange([...jurisprudenciales, jurisprudencial]);
          setJurisprudencial(createJurisprudencial());
        }}
      >
        Agregar referencia jurisprudencial
      </Button>
      {jurisprudenciales.length === 0 ? (
        <EmptyState title="Sin jurisprudencia relacionada" description="Agrega fallos vinculados o citados." />
      ) : (
        <div className={styles.list}>
          {jurisprudenciales.map((item) => (
            <article key={item.localId} className={styles.listItem}>
              <strong>{item.referencia}</strong>
              {item.textoOriginal ? <p>{item.textoOriginal}</p> : null}
              <div className={baseStyles.inlineActions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setJurisprudencial(item);
                    onJurisprudencialesChange(
                      jurisprudenciales.filter(
                        (current) => current.localId !== item.localId,
                      ),
                    );
                  }}
                >
                  Editar
                </Button>
                <Button variant="danger" onClick={() => onJurisprudencialesChange(jurisprudenciales.filter((current) => current.localId !== item.localId))}>
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  const renderDoctrinarias = () => (
    <div className={baseStyles.section}>
      <div className={baseStyles.formGrid}>
        <Input label="Autor" value={doctrinaria.autor} onChange={(event) => setDoctrinaria((current) => ({ ...current, autor: event.target.value }))} />
        <Input label="Titulo" value={doctrinaria.titulo} onChange={(event) => setDoctrinaria((current) => ({ ...current, titulo: event.target.value }))} />
        <Input label="Fuente" value={doctrinaria.fuente} onChange={(event) => setDoctrinaria((current) => ({ ...current, fuente: event.target.value }))} />
        <Input label="Año" type="number" value={doctrinaria.anio} onChange={(event) => setDoctrinaria((current) => ({ ...current, anio: event.target.value }))} />
        <Input label="URL" value={doctrinaria.url} onChange={(event) => setDoctrinaria((current) => ({ ...current, url: event.target.value }))} />
      </div>
      <Textarea label="Texto de referencia" value={doctrinaria.textoReferencia} onChange={(event) => setDoctrinaria((current) => ({ ...current, textoReferencia: event.target.value }))} />
      <Button
        onClick={() => {
          if (!doctrinaria.autor.trim() && !doctrinaria.titulo.trim() && !doctrinaria.textoReferencia.trim()) return;
          onDoctrinariasChange([...doctrinarias, doctrinaria]);
          setDoctrinaria(createDoctrinaria());
        }}
      >
        Agregar referencia doctrinaria
      </Button>
      {doctrinarias.length === 0 ? (
        <EmptyState title="Sin doctrina" description="Agrega doctrina relacionada si corresponde." />
      ) : (
        <div className={styles.list}>
          {doctrinarias.map((item) => (
            <article key={item.localId} className={styles.listItem}>
              <strong>{[item.autor, item.titulo].filter(Boolean).join(' - ') || 'Referencia doctrinaria'}</strong>
              <p>{[item.fuente, item.anio].filter(Boolean).join(' | ')}</p>
              {item.textoReferencia ? <p>{item.textoReferencia}</p> : null}
              <div className={baseStyles.inlineActions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDoctrinaria(item);
                    onDoctrinariasChange(
                      doctrinarias.filter((current) => current.localId !== item.localId),
                    );
                  }}
                >
                  Editar
                </Button>
                <Button variant="danger" onClick={() => onDoctrinariasChange(doctrinarias.filter((current) => current.localId !== item.localId))}>
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={baseStyles.section}>
      <div className={styles.tabs}>
        <Button variant={tab === 'normativas' ? 'primary' : 'secondary'} onClick={() => setTab('normativas')}>
          Normativas ({activeCount.normativas})
        </Button>
        <Button variant={tab === 'jurisprudenciales' ? 'primary' : 'secondary'} onClick={() => setTab('jurisprudenciales')}>
          Jurisprudenciales ({activeCount.jurisprudenciales})
        </Button>
        <Button variant={tab === 'doctrinarias' ? 'primary' : 'secondary'} onClick={() => setTab('doctrinarias')}>
          Doctrinarias ({activeCount.doctrinarias})
        </Button>
      </div>

      {tab === 'normativas' ? renderNormativas() : null}
      {tab === 'jurisprudenciales' ? renderJurisprudenciales() : null}
      {tab === 'doctrinarias' ? renderDoctrinarias() : null}
    </div>
  );
}
