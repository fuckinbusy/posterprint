/* Требования к макетам: светлый «лист» поверх фото цеха — как на старом
   сайте, где текст лежал белой карточкой на снимке печатной машины. */

import { Photo } from '@/components/Photo';
import { REQUIREMENTS } from '@/content';
import { SectionHead } from './SectionHead';

export function Requirements() {
  return (
    <section id="trebovaniya" className="sec req-sec" aria-labelledby="trebovaniya-title">
      <Photo className="req-bg" note="Широкоформатный принтер в работе" />
      <div className="wrap">
        <article className="sheet">
          {/* метки обреза по углам листа */}
          <span className="crop tl" aria-hidden="true" />
          <span className="crop tr" aria-hidden="true" />
          <span className="crop bl" aria-hidden="true" />
          <span className="crop br" aria-hidden="true" />
          <SectionHead label="Для дизайнеров" title="Требования к макетам" id="trebovaniya-title" />
          {REQUIREMENTS.map((block) => (
            <div key={block.heading} className="req-block">
              <h3>{block.heading}</h3>
              <div className="req-groups">
                {block.groups.map((group) => (
                  <div key={group.title} className="req-group">
                    <h4>{group.title}</h4>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}
