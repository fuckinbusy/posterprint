/* Услуги: список по группам и карточка выбранной услуги.

   Раньше четырнадцать услуг шли строками «фото + текст» — раздел тянулся
   на полтора десятка экранов. Теперь на широком экране слева список
   (группы → услуги), справа — фото, полный текст и кнопка выбранной.
   На узком экране списка слева нет: карточки идут друг за другом, у каждой
   заголовок-кнопка, и раскрыта одна.

   Тексты всех услуг всегда в разметке, просто скрыты: поисковик видит их
   целиком, а по ссылке ничего не теряется.

   Выбор один на оба вида: на широком экране показана карточка `active`
   (или первая, если на телефоне все свёрнуты), на узком раскрыта `active`,
   а -1 значит «все свёрнуты». */

import { useState } from 'react';
import { flushSync } from 'react-dom';

import { Photo } from '@/components/Photo';
import { useAskPrice } from '@/components/PriceDialog';
import { SERVICE_GROUPS, SERVICES, SERVICES_LEAD } from '@/content';
import { SectionHead } from './SectionHead';

// группы в порядке показа; номер услуги — сквозной по этому порядку
const GROUPED = SERVICE_GROUPS.map((group) => ({
  ...group,
  services: SERVICES.filter((service) => service.group === group.id),
}));
const ORDERED = GROUPED.flatMap((group) => group.services);
const TOTAL = String(ORDERED.length).padStart(2, '0');

const panelId = (i: number) => `usluga-${i + 1}`;

export function Services() {
  const askPrice = useAskPrice();
  const [active, setActive] = useState(0);
  const shown = active < 0 ? 0 : active;

  /* Телефон: нажатие по раскрытой карточке сворачивает её. Открытие
     сворачивает ту, что выше, и страница съезжает — заголовок только что
     открытой может уйти под шапку. flushSync перерисовывает список сразу,
     поэтому новое положение заголовка можно замерить тут же и, если он
     под шапкой, докрутить к нему. */
  const toggle = (i: number, button: HTMLElement) => {
    const opening = active !== i;
    flushSync(() => setActive(opening ? i : -1));
    if (!opening) return;
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    if (button.getBoundingClientRect().top < topbar) button.scrollIntoView({ block: 'start' });
  };

  return (
    <section id="uslugi" className="sec sec-panel" aria-labelledby="uslugi-title">
      <div className="wrap">
        <SectionHead label="Услуги" title="Наши услуги" lead={SERVICES_LEAD} id="uslugi-title" />
        <div className="svc">
          <nav className="svc-nav" aria-label="Список услуг">
            {GROUPED.map((group) => (
              <div key={group.id} className="svc-nav-group">
                <p className="svc-cat">{group.title}</p>
                <ul>
                  {group.services.map((service) => {
                    const i = ORDERED.indexOf(service);
                    return (
                      <li key={service.title}>
                        <button
                          type="button"
                          className={i === shown ? 'current' : undefined}
                          aria-current={i === shown}
                          aria-controls={panelId(i)}
                          onClick={() => setActive(i)}
                        >
                          {service.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="svc-panels">
            {GROUPED.map((group) => (
              <div key={group.id} className="svc-group">
                {/* подпись группы нужна только в раскрывающемся списке на телефоне */}
                <p className="svc-cat">{group.title}</p>
                {group.services.map((service) => {
                  const i = ORDERED.indexOf(service);
                  const open = i === active;
                  return (
                    <article
                      key={service.title}
                      className={`svc-item${i === shown ? ' current' : ''}${open ? ' open' : ''}`}
                    >
                      <button
                        type="button"
                        className="svc-toggle"
                        aria-expanded={open}
                        aria-controls={panelId(i)}
                        onClick={(event) => toggle(i, event.currentTarget)}
                      >
                        {service.title}
                        <span className="svc-plus" aria-hidden="true" />
                      </button>
                      <div className="svc-body" id={panelId(i)}>
                        <Photo className="svc-photo" note={service.photo} />
                        <div className="svc-copy">
                          <p className="svc-num">
                            {String(i + 1).padStart(2, '0')} / {TOTAL} · {group.title}
                          </p>
                          <h3>{service.title}</h3>
                          {service.text.map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                          ))}
                          <button className="btn btn-green" type="button" onClick={() => askPrice(service.title)}>
                            Узнать стоимость
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
