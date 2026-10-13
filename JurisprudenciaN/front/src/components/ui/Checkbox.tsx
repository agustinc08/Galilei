import styles from './ui.module.css';

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function Checkbox({ label, id, ...props }: CheckboxProps) {
  return (
    <label className={styles.checkboxRow} htmlFor={id}>
      <input id={id} type="checkbox" className={styles.checkbox} {...props} />
      <span>{label}</span>
    </label>
  );
}
