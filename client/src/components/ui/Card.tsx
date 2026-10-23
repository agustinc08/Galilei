import styles from "./ui.module.css";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn(styles.card, className)}>{children}</section>;
}
