import type { Metadata } from 'next';
import { FalloPublicoViewer } from '@/components/public/FalloPublicoViewer';
import type { ApiResponse } from '@/types/common';
import type { PublicSentencia } from '@/types/sentencia';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api').replace(/\/+$/, '');

type Props = {
  params: Promise<{ slug: string }>;
};

async function getPublicSentencia(slug: string) {
  try {
    const response = await fetch(`${API_URL}/public/sentencias/${slug}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ApiResponse<PublicSentencia>;
    return payload.data;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicSentencia(slug);
  if (!data) {
    return {
      title: 'Fallo no disponible | Jurisprudencia Civil',
      description: 'Consulta pública de jurisprudencia civil.',
    };
  }

  const title = `${data.caratula ?? data.numeroSentencia ?? `Fallo ${data.id}`} | Jurisprudencia Civil`;
  const description = (data.resumen ?? data.resena ?? data.sumarios?.[0]?.texto ?? 'Fallo publicado para consulta pública.')
    .replace(/\s+/g, ' ')
    .slice(0, 180);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
    },
  };
}

export default async function FalloPublicoPage({ params }: Props) {
  const { slug } = await params;
  return <FalloPublicoViewer identifier={slug} />;
}
