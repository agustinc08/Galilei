import { useParams } from '@/lib/router-compat';
import { FalloPublicoViewer } from '@/components/public/FalloPublicoViewer';
export default function FalloPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  return <FalloPublicoViewer identifier={slug ?? ''} />;
}
