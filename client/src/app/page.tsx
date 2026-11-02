import { Link } from "@/lib/router-compat";
import styles from './public-home.module.css';

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="public-home-title">
        <p className={styles.eyebrow}>Cámara Nacional de Apelaciones en lo Civil</p>
        <h1 id="public-home-title">Jurisprudencia Civil</h1>
        <p className={styles.description}>Consultá fallos y sumarios publicados por la Cámara.</p>
        <div className={styles.actions}>
          <Link className={styles.searchLink} href="/consulta">Buscar jurisprudencia</Link>
        </div>
      </section>
    </main>
  );
}
