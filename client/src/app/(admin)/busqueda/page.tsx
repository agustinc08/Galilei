import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { jurisprudenceSearchPathForRole } from '@/lib/jurisprudence-search-access';

export default function BusquedaPage() {
  const { user } = useAuth();
  return <Navigate to={jurisprudenceSearchPathForRole(user?.rol.nombre)} replace />;
}
