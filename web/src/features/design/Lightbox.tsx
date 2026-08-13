/* Превью во весь экран. */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface LightboxProps {
  url: string;
  title: string;
  onClose: () => void;
}

export function Lightbox({ url, title, onClose }: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc закрывает картинку, а не карточку заказа под ней
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Рисуем в body, а не внутри окна: картинка должна лечь поверх всего,
  // включая модалку с её собственным контекстом наложения.
  return createPortal(
    <div
      className="dz-light"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dz-light-bar">
        <span>{title}</span>
        <button type="button" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </div>
      <img src={url} alt={title} />
    </div>,
    document.body,
  );
}
