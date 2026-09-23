/* Первый экран: слайдер на всю ширину, как на старом сайте. Слайды
   листаются сами раз в несколько секунд; пока курсор или фокус на слайдере —
   стоят. Кто просил систему поменьше анимаций (prefers-reduced-motion),
   листает сам стрелками и точками. */

import { useCallback, useEffect, useState } from 'react';

import { IconArrowLeft, IconArrowRight } from '@/components/Icons';
import { Photo } from '@/components/Photo';
import { useAskPrice } from '@/components/PriceDialog';
import { SLIDES } from '@/content';

const INTERVAL_MS = 6000;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Hero() {
  const askPrice = useAskPrice();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = SLIDES.length;

  const go = useCallback((next: number) => setIndex((next + count) % count), [count]);

  // таймер пересоздаётся при каждой смене слайда: после ручного
  // переключения следующий слайд ждёт полный интервал, а не остаток
  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, go]);

  return (
    <section
      id="top"
      className="hero"
      aria-roledescription="карусель"
      aria-label="Чем мы занимаемся"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {SLIDES.map((slide, i) => (
        <div
          key={slide.title}
          className={`hero-slide${i === index ? ' current' : ''}`}
          role="group"
          aria-roledescription="слайд"
          aria-label={`${i + 1} из ${count}`}
          // невидимые слайды не должны ловить Tab и читаться скринридером
          inert={i !== index}
        >
          <Photo className="hero-photo" note={slide.photo} />
          <div className="hero-copy">
            <p className="eyebrow">Реклама &amp; полиграфия · Лазаревское</p>
            {/* заголовок страницы — только у первого слайда, остальные — подзаголовки */}
            {i === 0 ? <h1>{slide.title}</h1> : <p className="hero-title">{slide.title}</p>}
            <div className="hero-actions">
              <button className="btn btn-green btn-lg" type="button" onClick={() => askPrice()}>
                Узнать стоимость
              </button>
              <a className="btn btn-ghost btn-lg" href="/#uslugi">
                Наши услуги
              </a>
            </div>
          </div>
        </div>
      ))}

      <button className="hero-arrow prev" type="button" aria-label="Предыдущий слайд" onClick={() => go(index - 1)}>
        <IconArrowLeft />
      </button>
      <button className="hero-arrow next" type="button" aria-label="Следующий слайд" onClick={() => go(index + 1)}>
        <IconArrowRight />
      </button>

      <div className="hero-dots">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.title}
            type="button"
            className={i === index ? 'current' : undefined}
            aria-label={`Слайд ${i + 1}`}
            aria-current={i === index}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </section>
  );
}
