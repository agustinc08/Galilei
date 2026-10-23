'use client';

import { useState } from 'react';
import type { AccionLog } from '@/types/logs';
import { EmptyState } from '../ui/EmptyState';
import { TimelineItem } from './TimelineItem';

type Props = {
  items: AccionLog[];
};

export function SentenciaTimeline({ items }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Sin historial"
        description="Todavia no hay acciones auditadas vinculadas a este fallo."
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {items.map((item) => (
        <TimelineItem
          key={item.id}
          item={item}
          expanded={openId === item.id}
          onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
        />
      ))}
    </div>
  );
}
