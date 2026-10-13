'use client';

import { PageHeader } from '@/components/ui/PageHeader';
import { SentenciaWizard } from '@/components/sentencias/SentenciaWizard';

export default function NuevaSentenciaCompletaPage() {
  return (
    <div>
      <PageHeader
        title="Nueva sentencia completa"
        description="Formulario por pasos para cargar datos, PDF, sumarios, reseña, referencias y publicación."
      />
      <SentenciaWizard />
    </div>
  );
}
