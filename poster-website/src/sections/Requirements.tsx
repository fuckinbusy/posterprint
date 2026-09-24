/* Требования к макетам: светлый «лист» поверх фото цеха — как на старом
   сайте, где текст лежал белой карточкой на снимке печатной машины.

   Внутри листа — не сплошной список, а то, что дизайнер ищет глазами:
   форматы файлов плашками, вылеты таблицей с крупными цифрами и три
   короткие колонки правил. Всё видно сразу, ничего не спрятано. */

import { Photo } from '@/components/Photo';
import { BLEEDS, FILE_FORMATS, FILE_RULES, LAYOUT_RULES } from '@/content';
import { SectionHead } from './SectionHead';

function Rules({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="req-col">
      <h4>{title}</h4>
      <ul className="req-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

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

          <div className="req-top">
            <div className="req-formats">
              <h3>Допустимые форматы файлов</h3>
              {FILE_FORMATS.map((kind) => (
                <div key={kind.title} className="req-format-row">
                  <h4>{kind.title}</h4>
                  <ul>
                    {kind.items.map((format) => (
                      <li key={format.ext}>
                        <b>{format.ext}</b>
                        {format.note && <span>{format.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="req-bleeds">
              <h3>Вылеты — не менее</h3>
              <table>
                <tbody>
                  {BLEEDS.map((bleed) => (
                    <tr key={bleed.what}>
                      <th scope="row">
                        {bleed.what}
                        <span>{bleed.note}</span>
                      </th>
                      <td>{bleed.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h3 className="req-subhead">Общие требования к электронному макету</h3>
          <div className="req-cols">
            <Rules title="Макет" items={LAYOUT_RULES} />
            {FILE_RULES.map((group) => (
              <Rules key={group.title} title={group.title} items={group.items} />
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
