'use client';

import { useRouter } from 'next/navigation';
import { SentenciaForm } from '@/components/sentencias/SentenciaForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import type { ApiResponse } from '@/types/common';
import type { Sentencia, SentenciaFormValues } from '@/types/sentencia';

const initialValues: SentenciaFormValues = {
  numeroSentencia: '',
  tipoFallo: '',
  tipoFalloId: '',
  sala: '',
  salaId: '',
  fecha: '',
  expediente: '',
  tribunalOrigen: '',
  tribunalOrigenId: '',
  caratula: '',
  actor: '',
  demandado: '',
  objeto: '',
  magistrados: '',
  observacionesInternas: '',
  estadoCarga: 'BORRADOR',
  publicado: false,
  activo: true,
};

export default function NuevaSentenciaPage() {
  const router = useRouter();
  const { salas, tiposFallo, tribunalesOrigen } = useCatalogos();

  const handleSubmit = async (values: SentenciaFormValues) => {
    const response = await api.post<ApiResponse<Sentencia>>('/sentencias', {
      ...values,
      fecha: values.fecha ? new Date(values.fecha).toISOString() : undefined,
    });

    router.push(`/sentencias/${response.data.id}`);
  };

  return (
    <div>
      <PageHeader
        title="Nueva sentencia"
        description="Completa los datos basicos para registrar una sentencia."
      />
      <Card>
        <SentenciaForm
          key="nueva-sentencia"
          initialValues={initialValues}
          submitLabel="Crear sentencia"
          onSubmit={handleSubmit}
          salas={salas}
          tiposFallo={tiposFallo}
          tribunalesOrigen={tribunalesOrigen}
        />
      </Card>
    </div>
  );
}
