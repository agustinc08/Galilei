'use client';

import { cn } from '@/lib/utils';
import styles from './wizard.module.css';

type Props = {
  steps: string[];
  currentStep: number;
};

export function WizardStepIndicator({ steps, currentStep }: Props) {
  return (
    <div className={styles.stepIndicator}>
      {steps.map((step, index) => (
        <article
          key={step}
          className={cn(
            styles.stepItem,
            index === currentStep && styles.stepItemActive,
            index < currentStep && styles.stepItemDone,
          )}
        >
          <span className={styles.stepNumber}>Paso {index + 1}</span>
          <strong className={styles.stepTitle}>{step}</strong>
        </article>
      ))}
    </div>
  );
}
