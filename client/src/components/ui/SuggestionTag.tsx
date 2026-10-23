import styles from './search-autocomplete.module.css';

type Props = {
  label: string;
};

export function SuggestionTag({ label }: Props) {
  return <span className={styles.tag}>{label}</span>;
}
