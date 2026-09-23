/* Заголовок раздела: номер-метка с приводочным крестом и крупное название.
   Номер — как метка на печатном листе, тот же приём, что в системе. */

import type { ReactNode } from 'react';

import { RegMark } from '@/components/Brand';

type Props = {
  num: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
};

export function SectionHead({ num, label, title, lead, id }: Props) {
  return (
    <div className="sec-head">
      <p className="eyebrow">
        <RegMark />
        {num} · {label}
      </p>
      <h2 id={id}>{title}</h2>
      {lead && <p className="sec-lead">{lead}</p>}
    </div>
  );
}
