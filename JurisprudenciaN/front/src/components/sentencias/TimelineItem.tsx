'use client';

import { formatDateTime } from '@/lib/utils';
import type { AccionLog } from '@/types/logs';
import { Button } from '../ui/Button';
import { LogDiffViewer } from './LogDiffViewer';

type Props = {
  item: AccionLog;
  expanded: boolean;
  onToggle: () => void;
};

export function TimelineItem({ item, expanded, onToggle }: Props) {
  return (
    <article
      style={{
        borderLeft: '3px solid #cbd5e1',
        paddingLeft: 16,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{item.descripcion ?? `${item.accion} ${item.entidad}`}</strong>
          <div>
            {item.usuario.nombre} {item.usuario.apellido ?? ''} · {item.entidad}
          </div>
        </div>
        <span>{formatDateTime(item.createdAt)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{item.accion}</span>
        {item.entidadId ? <span>#{item.entidadId}</span> : null}
        <Button variant="secondary" onClick={onToggle}>
          {expanded ? 'Ocultar cambios' : 'Ver cambios'}
        </Button>
      </div>
      {expanded ? (
        <LogDiffViewer before={item.datosAntes} after={item.datosDespues} />
      ) : null}
    </article>
  );
}
