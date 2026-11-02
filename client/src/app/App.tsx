import { lazy, Suspense, type ComponentType } from 'react';
import { Outlet, useRoutes, type RouteObject } from 'react-router-dom';
import AdminOnlyLayout from '@/app/(admin)/admin/layout';
import AdminLayout from '@/app/(admin)/layout';
import RootLayout from '@/app/layout';
import { PublicJurisprudenceShell } from '@/components/layout/PublicJurisprudenceShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Link } from '@/lib/router-compat';
import styles from './not-found.module.css';

type PageModule = { default: ComponentType };
type PageLoader = () => Promise<PageModule>;

const pageLoaders = import.meta.glob<PageModule>('./**/page.tsx');

function routePath(file: string) {
  const routeDirectory = file
    .replace(/^\.\//u, '')
    .replace(/(?:^|\/)page\.tsx$/u, '');
  const segments = routeDirectory
    .split('/')
    .filter((segment) => segment.length > 0 && !/^\(.+\)$/u.test(segment))
    .map((segment) => {
      const catchAll = segment.match(/^\[\.\.\.(.+)\]$/u);
      if (catchAll) return '*';
      const parameter = segment.match(/^\[(.+)\]$/u);
      return parameter ? `:${parameter[1]}` : segment;
    });

  return segments.join('/');
}

const pages = Object.entries(pageLoaders).map(([file, load]) => {
  const Page = lazy(load as PageLoader);
  const path = routePath(file);
  const route: RouteObject = {
    ...(path ? { path } : { index: true }),
    element: <Page />,
  };
  return { file, path, route };
});

const isAdminPage = (file: string) => file.startsWith('./(admin)/');
const isAdminOnlyPage = (file: string) =>
  file.startsWith('./(admin)/admin/') &&
  !file.startsWith('./(admin)/admin/jurisprudencia/ocr/');

const loginRoute = pages.find(({ path }) => path === 'login')?.route;
const privateStandaloneRoutes = pages
  .filter(({ file, path }) => !isAdminPage(file) && path === 'evolucion/guardada/:id')
  .map(({ route }) => route);
const publicContentRoutes = pages
  .filter(({ file, path }) => !isAdminPage(file) && path !== 'login' && path !== 'evolucion/guardada/:id')
  .map(({ route }) => route);
const adminRoutes = pages
  .filter(({ file }) => isAdminPage(file) && !isAdminOnlyPage(file))
  .map(({ route }) => route);
const adminOnlyRoutes = pages
  .filter(({ file }) => isAdminOnlyPage(file))
  .map(({ path, route }) => ({
    ...route,
    path: path.replace(/^admin\//u, ''),
  }));

const AuthenticatedAppShell = lazy(() =>
  import('@/components/layout/AuthenticatedAppShell').then((module) => ({ default: module.AuthenticatedAppShell })),
);

const routes: RouteObject[] = [
  {
    element: <RootLayout><Outlet /></RootLayout>,
    children: [
      {
        element: <PublicJurisprudenceShell><Outlet /></PublicJurisprudenceShell>,
        children: publicContentRoutes,
      },
      {
        element: <Suspense fallback={<LoadingSpinner label="Cargando Galilei…" />}><AuthenticatedAppShell><Outlet /></AuthenticatedAppShell></Suspense>,
        children: [
          {
            element: <AdminLayout><Outlet /></AdminLayout>,
            children: [
              ...adminRoutes.filter((route) => route.path !== 'admin/logs'),
              ...privateStandaloneRoutes,
              {
                path: 'admin',
                element: <AdminOnlyLayout><Outlet /></AdminOnlyLayout>,
                children: adminOnlyRoutes,
              },
            ],
          },
          ...(loginRoute ? [loginRoute] : []),
        ],
      },
      {
        path: '*',
        element: (
          <main className={styles.page}>
            <section className={styles.card} aria-labelledby="not-found-title">
              <p className={styles.code}>404</p>
              <h1 className={styles.heading} id="not-found-title">
                Página no encontrada
              </h1>
              <p className={styles.description}>
                La dirección no corresponde a una sección disponible.
              </p>
              <Link className={styles.link} href="/">
                Volver al inicio
              </Link>
            </section>
          </main>
        ),
      },
    ],
  },
];

export function App() {
  const routeElement = useRoutes(routes);
  return <Suspense fallback={<LoadingSpinner label="Cargando…" />}>{routeElement}</Suspense>;
}

export const routeInventory = pages.map(({ file, path }) => ({ file, path: path ? `/${path}` : '/' }));
