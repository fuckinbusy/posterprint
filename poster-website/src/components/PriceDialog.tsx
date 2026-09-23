/* «Узнать стоимость»: окно со способами связаться.

   Своей формы заявки у сайта нет — ей нужен сервер, который примет письмо.
   Пока кнопка открывает окно с мессенджерами и телефоном; в WhatsApp
   сообщение сразу подставляется с названием услуги. Любая кнопка на сайте
   зовёт окно через useAskPrice(), не зная, где оно нарисовано. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { CONTACTS } from '@/content';
import { IconClose, IconMail, IconPhone, IconTelegram, IconWhatsApp } from './Icons';

type AskPrice = (service?: string) => void;

const AskPriceContext = createContext<AskPrice>(() => {});

export function useAskPrice() {
  return useContext(AskPriceContext);
}

export function PriceDialogProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [service, setService] = useState<string | undefined>();
  const [open, setOpen] = useState(false);

  const ask = useCallback<AskPrice>((name) => {
    setService(name);
    setOpen(true);
  }, []);

  // showModal, а не атрибут open: так браузер сам держит фокус внутри окна,
  // закрывает его по Esc и затемняет страницу позади
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const greeting = service
    ? `Здравствуйте! Хочу узнать стоимость: ${service.toLowerCase()}.`
    : 'Здравствуйте! Хочу узнать стоимость заказа.';
  const whatsapp = `${CONTACTS.whatsapp}?text=${encodeURIComponent(greeting)}`;
  const mail = `mailto:${CONTACTS.email}?subject=${encodeURIComponent(service ? `Стоимость: ${service}` : 'Стоимость заказа')}`;

  return (
    <AskPriceContext value={ask}>
      {children}
      <dialog
        ref={dialog}
        className="price"
        aria-labelledby="price-title"
        onClose={() => setOpen(false)}
        // щелчок по затемнению вокруг окна: целью события будет сам <dialog>
        onClick={(event) => event.target === event.currentTarget && setOpen(false)}
      >
        <div className="price-box">
          <button className="icon-btn price-close" type="button" aria-label="Закрыть" onClick={() => setOpen(false)}>
            <IconClose />
          </button>
          <p className="eyebrow">Узнать стоимость</p>
          <h2 id="price-title">{service ?? 'Расскажите о заказе'}</h2>
          <p className="price-text">
            Напишите, что нужно сделать, — размеры, количество, есть ли готовый макет. Посчитаем и ответим.
          </p>
          <div className="price-actions">
            <a className="btn btn-green" href={whatsapp} target="_blank" rel="noreferrer">
              <IconWhatsApp /> WhatsApp
            </a>
            <a className="btn btn-ghost" href={CONTACTS.telegram} target="_blank" rel="noreferrer">
              <IconTelegram /> Telegram
            </a>
            <a className="btn btn-ghost" href={CONTACTS.phoneHref}>
              <IconPhone /> {CONTACTS.phone}
            </a>
            <a className="btn btn-ghost" href={mail}>
              <IconMail /> Почта
            </a>
          </div>
        </div>
      </dialog>
    </AskPriceContext>
  );
}
