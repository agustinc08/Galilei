import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import styles from './home.module.css';

const cards = [
  {
    title: 'Búsqueda global',
    text: 'Buscá jurisprudencia y documentos autorizados desde una sola pantalla.',
  },
  {
    title: 'Jurisprudencia',
    text: 'Sentencias, sumarios, temas y decisiones editoriales conservan su identidad.',
  },
  {
    title: 'Digesto',
    text: 'Colecciones y temas organizan documentos sin duplicar los archivos.',
  },
  {
    title: 'Repositorio documental',
    text: 'Procedencia, lectura, navegación de coincidencias y curaduría trazable.',
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.brandBlock}>
          <span className={styles.kicker}>Buscador Jurídico Civil</span>
          <h1>Jurisprudencia y documentos en un mismo lugar</h1>
          <p>
            Buscá, leé y organizá jurisprudencia y documentos con su procedencia,
            permisos y estado editorial visibles.
          </p>
        </div>

        <div className={styles.actions}>
          <Link href="/busqueda-avanzada">
            <Button>Buscar documentos</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary">Ingresar</Button>
          </Link>
        </div>
      </section>

      <section className={styles.cards} aria-label="Secciones principales">
        {cards.map((card) => (
          <article key={card.title} className={styles.card}>
            <strong>{card.title}</strong>
            <p>{card.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
