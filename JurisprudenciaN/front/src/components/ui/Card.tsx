import styles from './ui.module.css';

export function Card({ children }: { children: React.ReactNode }) {
  return <section className={styles.card}>{children}</section>;
}
