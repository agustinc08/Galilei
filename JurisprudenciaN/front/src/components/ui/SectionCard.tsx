import { Card } from './Card';

type Props = {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function SectionCard({ title, actions, children }: Props) {
  return (
    <Card>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <strong>{title}</strong>
          {actions}
        </div>
        {children}
      </div>
    </Card>
  );
}
