import styles from './ui.module.css';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderTitle}>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className={styles.gridActions}>{actions}</div> : null}
    </div>
  );
}
