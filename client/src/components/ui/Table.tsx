import styles from './ui.module.css';

export function Table({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}
