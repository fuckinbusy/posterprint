/* Заглушка на месте фотографии. Когда появятся снимки, здесь станет <img>,
   а подпись `note` — его alt. Пока подпись видна: по ней понятно, какой
   снимок сюда нужен. */

import { RegMark } from './Brand';

type Props = {
  note?: string;
  className?: string;
};

export function Photo({ note, className = '' }: Props) {
  return (
    <div className={`ph ${className}`} role="img" aria-label={note ? `Фото: ${note}` : 'Фото'}>
      <span className="ph-mark">
        <RegMark />
        PHOTO HERE
      </span>
      {note && <span className="ph-note">{note}</span>}
    </div>
  );
}
