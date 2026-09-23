import { Photo } from '@/components/Photo';
import { PORTFOLIO } from '@/content';
import { SectionHead } from './SectionHead';

export function Portfolio() {
  return (
    <section id="portfolio" className="sec" aria-labelledby="portfolio-title">
      <div className="wrap">
        <SectionHead num="03" label="Портфолио" title="Наши работы" id="portfolio-title" />
        <ul className="works">
          {PORTFOLIO.map((work) => (
            <li key={work}>
              <Photo className="work-photo" />
              <p>{work}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
