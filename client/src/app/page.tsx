import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import styles from './home.module.css';

const destinations = [
  { href: '/consulta', icon: '⚖', title: 'Jurisprudencia', text: 'Buscar fallos publicados.' },
  { href: '/spaces', icon: '🏛', title: 'Mi Sala / Juzgado', text: 'Documentos compartidos de tu dependencia.' },
  { href: '/personal', icon: '🔒', title: 'Mis documentos', text: 'Tus archivos privados.' },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <header className={styles.brandBlock}>
          <span className={styles.kicker}>Galilei</span>
          <h1>¿Qué querés consultar?</h1>
          <p>Jurisprudencia, documentos compartidos de tu dependencia y tus archivos privados.</p>
        </header>
        <nav className={styles.cards} aria-label="Secciones de Galilei">
          {destinations.map((destination) => (
            <Link className={styles.card} href={destination.href} key={destination.href}>
              <span aria-hidden="true">{destination.icon}</span>
              <strong>{destination.title}</strong>
              <p>{destination.text}</p>
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <Link href="/login"><Button>Iniciar sesión</Button></Link>
        </div>
      </section>
    </main>
  );
}
