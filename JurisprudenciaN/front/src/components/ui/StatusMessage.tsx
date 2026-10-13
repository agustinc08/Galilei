import { cn } from '@/lib/utils';
import styles from './ui.module.css';

export function StatusMessage({
  variant,
  title,
  message,
}: {
  variant: 'error' | 'success';
  title: string;
  message?: string;
}) {
  return (
    <div
      className={cn(
        styles.statusMessage,
        variant === 'error'
          ? styles.statusMessageError
          : styles.statusMessageSuccess,
      )}
    >
      <strong>{title}</strong>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
