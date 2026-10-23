'use client';

import { useState } from 'react';
import type { Option } from '@/types/common';
import { Button } from './Button';
import { Select } from './Select';

type Props = {
  options?: Option[];
  onExport: (format: string) => Promise<void> | void;
};

const defaultOptions: Option[] = [
  { label: 'CSV', value: 'csv' },
  { label: 'JSON', value: 'json' },
  { label: 'TXT', value: 'txt' },
];

export function ExportMenu({ options = defaultOptions, onExport }: Props) {
  const [format, setFormat] = useState(options[0]?.value ?? 'csv');

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
      <Select
        label="Formato"
        options={options}
        value={format}
        onChange={(event) => setFormat(event.target.value)}
      />
      <Button variant="secondary" onClick={() => void onExport(format)}>
        Exportar
      </Button>
    </div>
  );
}
