/* «Нам доверяют»: логотипы клиентов бегущей лентой. Под курсором лента
   останавливается — чтобы логотип можно было рассмотреть.

   Как устроен бесконечный круг. Лента — две одинаковые группы подряд, и
   каждая растянута минимум на ширину экрана. Обе едут влево ровно на свою
   ширину, а потом анимация начинается заново: вторая группа в этот момент
   стоит там, где стояла первая, и шва не видно. Логотипов может быть сколько
   угодно мало — группа всё равно шире экрана, пустой щели не появится.

   Скорость постоянная, а не время круга: время растёт с числом логотипов
   (--marquee-duration), иначе длинная лента неслась бы, а короткая ползла.
   Без анимаций (prefers-reduced-motion) лента стоит и листается рукой. */

import type { CSSProperties } from 'react';

import { Photo } from '@/components/Photo';
import { CLIENTS } from '@/content';
import { SectionHead } from './SectionHead';

const SECONDS_PER_LOGO = 4;

function Group({ hidden }: { hidden?: boolean }) {
  return (
    // вторая группа — копия для круга: скринридеру её читать незачем
    <ul className="marquee-group" aria-hidden={hidden || undefined}>
      {CLIENTS.map((client) => (
        <li key={client} className="client">
          <Photo className="client-logo" note={client} />
        </li>
      ))}
    </ul>
  );
}

export function Clients() {
  const style = { '--marquee-duration': `${CLIENTS.length * SECONDS_PER_LOGO}s` } as CSSProperties;

  return (
    <section id="klienty" className="sec sec-panel" aria-labelledby="klienty-title">
      <div className="wrap">
        <SectionHead label="Клиенты" title="Нам доверяют" id="klienty-title" />
      </div>
      <div className="marquee" style={style}>
        <Group />
        <Group hidden />
      </div>
    </section>
  );
}
