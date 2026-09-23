/* Услуги: снимок и текст, строки чередуют сторону — как на старом сайте.
   Кнопка у каждой услуги открывает окно «Узнать стоимость» уже с её
   названием. */

import { Photo } from '@/components/Photo';
import { useAskPrice } from '@/components/PriceDialog';
import { SERVICES, SERVICES_LEAD } from '@/content';
import { SectionHead } from './SectionHead';

export function Services() {
  const askPrice = useAskPrice();
  const total = String(SERVICES.length).padStart(2, '0');

  return (
    <section id="uslugi" className="sec sec-panel" aria-labelledby="uslugi-title">
      <div className="wrap">
        <SectionHead num="02" label="Услуги" title="Наши услуги" lead={SERVICES_LEAD} id="uslugi-title" />
        <ol className="services">
          {SERVICES.map((service, i) => (
            <li key={service.title} className="service">
              <Photo className="service-photo" note={service.photo} />
              <div className="service-copy">
                <p className="service-num">
                  {String(i + 1).padStart(2, '0')} / {total}
                </p>
                <h3>{service.title}</h3>
                {service.text.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <button className="btn btn-green" type="button" onClick={() => askPrice(service.title)}>
                  Узнать стоимость
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
