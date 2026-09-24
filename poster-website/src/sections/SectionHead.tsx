/* Заголовок раздела: короткая метка над крупным названием. */

import type { ReactNode } from 'react';

type Props = {
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
};

export function SectionHead({ label, title, lead, id }: Props) {
  return (
    <div className="sec-head">
      <p className="eyebrow">{label}</p>
      <h2 id={id}>{title}</h2>
      {lead && <p className="sec-lead">{lead}</p>}
    </div>
  );
}
