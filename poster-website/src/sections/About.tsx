import { useAskPrice } from '@/components/PriceDialog';
import { ABOUT, SERVICES } from '@/content';
import { SectionHead } from './SectionHead';

// все цифры отсюда есть в текстах сайта; число услуг считается по списку
const FACTS = [
  { value: '25', label: 'лет на рынке рекламы и полиграфии' },
  { value: String(SERVICES.length), label: 'видов услуг — от наклейки до световой вывески' },
  { value: '1', label: 'подрядчик на весь цикл: дизайн, производство, монтаж' },
];

export function About() {
  const askPrice = useAskPrice();
  const [lead, ...rest] = ABOUT;

  return (
    <section id="o-nas" className="sec" aria-labelledby="o-nas-title">
      <div className="wrap">
        <SectionHead label="О нас" title="Реклама и полиграфия полного цикла" id="o-nas-title" />
        <div className="about">
          <p className="about-lead">{lead}</p>
          <div className="about-text">
            {rest.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <button className="btn btn-green btn-lg" type="button" onClick={() => askPrice()}>
              Узнать стоимость
            </button>
          </div>
        </div>
        <ul className="facts">
          {FACTS.map((fact) => (
            <li key={fact.label}>
              <b>{fact.value}</b>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
