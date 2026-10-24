import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
  type LinkProps as RouterLinkProps,
  type To,
} from 'react-router-dom';

type LinkCompatProps = Omit<RouterLinkProps, 'to'> & { href: To };

export function Link({ href, ...props }: LinkCompatProps) {
  return <RouterLink to={href} {...props} />;
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const [searchParams] = useRouterSearchParams();
  return searchParams;
}

export const useParams = useRouterParams;

export function useRouter() {
  const navigate = useNavigate();

  return useMemo(() => ({
    push: (to: To, options?: { scroll?: boolean }) => navigate(to, { preventScrollReset: options?.scroll === false }),
    replace: (to: To, options?: { scroll?: boolean }) => navigate(to, { replace: true, preventScrollReset: options?.scroll === false }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
  }), [navigate]);
}

type DynamicOptions = { loading?: () => ReactNode; ssr?: boolean };

export default function dynamic<Props extends object>(
  loader: () => Promise<ComponentType<Props> | { default: ComponentType<Props> }>,
  options: DynamicOptions = {},
): ComponentType<Props> {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    return typeof loaded === 'function' ? { default: loaded } : loaded;
  });

  function DynamicComponent(props: Props) {
    return (
      <Suspense fallback={options.loading?.() ?? null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }

  return DynamicComponent;
}
