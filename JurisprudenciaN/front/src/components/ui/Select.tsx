import type { Option } from '@/types/common';
import styles from './ui.module.css';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: Option[];
};

export function Select({ label, id, options, ...props }: SelectProps) {
  return (
    <label className={styles.field} htmlFor={id}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <select id={id} className={styles.select} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
