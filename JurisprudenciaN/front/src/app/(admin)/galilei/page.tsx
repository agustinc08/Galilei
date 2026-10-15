import Link from 'next/link';
import styles from './galilei.module.css';

const destinations = [
  {
    href: '/consulta',
    icon: '⚖',
    title: 'Jurisprudencia',
    description: 'Buscar fallos publicados.',
  },
  {
    href: '/spaces',
    icon: '🏛',
    title: 'Mi Sala / Juzgado',
    description: 'Documentos compartidos de tu dependencia.',
  },
  {
    href: '/personal',
    icon: '🔒',
    title: 'Mis documentos',
    description: 'Archivos privados que sólo podés ver vos.',
  },
];

export default function GalileiHomePage() {
  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <h1>¿Qué querés consultar?</h1>
        <p>Elegí dónde buscar. Cada espacio conserva sus propios permisos.</p>
      </header>
      <nav className={styles.destinations} aria-label="Elegir dónde consultar">
        {destinations.map((destination) => (
          <Link className={styles.destination} href={destination.href} key={destination.href}>
            <span aria-hidden="true">{destination.icon}</span>
            <strong>{destination.title}</strong>
            <span>{destination.description}</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
