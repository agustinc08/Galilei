import styles from './ui.module.css';

export function LoadingSpinner({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className={styles.loading}>
      <div className={styles.spinner} />
      <span>{label}</span>
    </div>
  );
}
