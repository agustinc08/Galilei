import { cn } from '@/lib/utils';
import styles from './ui.module.css';

export function StatusMessage({
  variant,
  title,
  message,
}: {
  variant: 'error' | 'success' | 'info';
  title: string;
  message?: string;
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        styles.statusMessage,
        variant === 'error'
          ? styles.statusMessageError
          : variant === 'success'
            ? styles.statusMessageSuccess
            : styles.statusMessageInfo,
      )}
    >
      <strong>{title}</strong>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
