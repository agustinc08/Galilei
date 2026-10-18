import styles from './ui.module.css';

export function LoadingSpinner({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
