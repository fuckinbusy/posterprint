/* Контакты и карта.

   Карта — виджет Яндекс.Карт во фрейме (yandex.ru/map-widget). Ему не
   нужен ключ API и не нужен скрипт на странице: это та же карта, что на
   yandex.ru/maps, с поиском, пробками и кнопкой «Как добраться». На старом
   сайте карта Tilda стояла с координатами Москвы и показывала «нет данных» —
   здесь метку ставит поиск по адресу (MAP в content.ts).

   Фрейм грузится лениво (loading="lazy"): карта в самом низу страницы, и
   тому, кто до неё не долистал, она не стоит ни трафика, ни времени. */

import type { ReactNode } from 'react';

import { IconMail, IconPhone, IconPin, IconTelegram, IconVk, IconWhatsApp } from '@/components/Icons';
import { CONTACTS, MAP } from '@/content';
import { SectionHead } from './SectionHead';

function mapWidgetUrl() {
  const params = new URLSearchParams({ z: String(MAP.zoom), lang: 'ru_RU' });
  if (MAP.point) {
    const ll = MAP.point.join(',');
    params.set('ll', ll);
    params.set('pt', `${ll},pm2gnm`);
  } else {
    params.set('text', MAP.query);
  }
  return `https://yandex.ru/map-widget/v1/?${params}`;
}

// ссылка «Построить маршрут» открывает Яндекс.Карты с адресом в поиске
const ROUTE_URL = `https://yandex.ru/maps/?text=${encodeURIComponent(MAP.query)}`;

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li>
      <span className="contact-ico">{icon}</span>
      <div>{children}</div>
    </li>
  );
}

export function Contacts() {
  return (
    <section id="kontakty" className="sec contacts-sec" aria-labelledby="kontakty-title">
      <div className="wrap contacts">
        <div>
          <SectionHead num="06" label="Контакты" title="Приходите или напишите" id="kontakty-title" />
          <a className="contact-phone" href={CONTACTS.phoneHref}>
            {CONTACTS.phone}
          </a>
          <ul className="contact-list">
            <Row icon={<IconPin />}>
              {CONTACTS.city}, {CONTACTS.street}
              <br />
              <a href={ROUTE_URL} target="_blank" rel="noreferrer">
                Построить маршрут →
              </a>
            </Row>
            <Row icon={<IconMail />}>
              <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
            </Row>
            <Row icon={<IconPhone />}>
              <a href={CONTACTS.phoneHref}>{CONTACTS.phone}</a> — звонки, WhatsApp, Telegram
            </Row>
          </ul>
          <div className="socials">
            <a className="icon-btn" href={CONTACTS.telegram} target="_blank" rel="noreferrer" aria-label="Telegram">
              <IconTelegram />
            </a>
            <a className="icon-btn" href={CONTACTS.whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp">
              <IconWhatsApp />
            </a>
            <a className="icon-btn" href={CONTACTS.vk} target="_blank" rel="noreferrer" aria-label="ВКонтакте">
              <IconVk />
            </a>
          </div>
        </div>
        <div className="map">
          <iframe
            src={mapWidgetUrl()}
            title={`Карта: ${CONTACTS.city}, ${CONTACTS.street}`}
            loading="lazy"
            allowFullScreen
          />
        </div>
      </div>
    </section>
  );
}
