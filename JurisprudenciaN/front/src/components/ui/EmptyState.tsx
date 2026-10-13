import { Button } from './Button';
import styles from './ui.module.css';

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className={styles.emptyState}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {actionLabel && actionHref ? (
        <a href={actionHref}>
          <Button variant="secondary">{actionLabel}</Button>
        </a>
      ) : null}
    </div>
  );
}
