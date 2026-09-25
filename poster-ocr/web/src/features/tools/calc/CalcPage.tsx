/* Калькулятор для цеха: деньги (НДС, наценка, разделить, сдача, курсы ЦБ),
   метраж (площадь, погонаж, листы, рулон), дизайн (px ↔ мм, DPI, пропорции,
   вылеты), единицы. Вся математика — в calc.ts, здесь только поля и вывод.
   Считается сразу при вводе; у каждого результата — «копировать». */

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { fetchRates } from '@/api/tools';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Field, PageHead, Section } from '@/components/ui';
import { ToolsNotice } from '@/features/tools/ToolsNotice';

import * as calc from './calc';

type Tab = 'money' | 'area' | 'design' | 'units';
const TABS: { key: Tab; label: string }[] = [
  { key: 'money', label: 'Деньги' },
  { key: 'area', label: 'Метраж' },
  { key: 'design', label: 'Дизайн' },
  { key: 'units', label: 'Единицы' },
];
const LENGTH_OPTIONS = Object.entries(calc.LENGTH_LABELS).map(([value, label]) => ({ value, label }));
const WEIGHT_OPTIONS = [
  { value: 'g', label: 'г' },
  { value: 'kg', label: 'кг' },
  { value: 't', label: 'т' },
];
const ROLLS = [
  { value: '1070', label: '1070 мм' },
  { value: '1270', label: '1270 мм' },
  { value: '1370', label: '1370 мм' },
  { value: '1600', label: '1600 мм' },
  { value: '3200', label: '3200 мм' },
];

const fmt = (v: number, digits = 2): string =>
  Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';

/** Числовое поле: хранит строку (чтобы можно было стереть), наружу — число. */
function Num({ label, value, onChange, step = 'any', hint }: { label: ReactNode; value: string; onChange: (v: string) => void; step?: string; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
const num = (s: string): number => (s.trim() === '' ? 0 : Number(s.replace(',', '.')) || 0);

function Result({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const { toast } = useToast();
  return (
    <div className="calc-result">
      <span>{label}</span>
      <b>
        {value}
        {unit ? ` ${unit}` : ''}
      </b>
      <button
        type="button"
        className="icon-btn"
        title="Копировать"
        aria-label={`Копировать ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => toast('Скопировано'));
        }}
      >
        ⧉
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ деньги */
function Money() {
  const [amount, setAmount] = useState('1000');
  const [rate, setRate] = useState('22');
  const [mode, setMode] = useState<'add' | 'extract'>('add');
  const v = calc.vat(num(amount), num(rate), mode);

  const [cost, setCost] = useState('');
  const [percent, setPercent] = useState('30');
  const [price, setPrice] = useState('');
  const [disc, setDisc] = useState('10');

  const [total, setTotal] = useState('');
  const [parts, setParts] = useState('3');
  const [paid, setPaid] = useState('');
  const [due, setDue] = useState('');

  const rates = useQuery({ queryKey: ['rates'], queryFn: fetchRates, staleTime: 60 * 60 * 1000, retry: 1 });
  const [cur, setCur] = useState('USD');
  const [curAmount, setCurAmount] = useState('100');
  const [dir, setDir] = useState<'to' | 'from'>('to');
  const rateValue = rates.data?.rates[cur]?.value ?? 0;
  const curOptions = ['USD', 'EUR', 'CNY'].map((c) => ({
    value: c,
    label: c,
    hint: rates.data ? `${fmt(rates.data.rates[c]?.value ?? 0, 4)} ₽` : '',
  }));

  return (
    <div className="calc-grid">
      <Section title="НДС">
        <Num label="Сумма, ₽" value={amount} onChange={setAmount} />
        <div className="ip-pair">
          <Num label="Ставка, %" value={rate} onChange={setRate} />
          <Field label="Сумма указана">
            <Select
              value={mode}
              options={[
                { value: 'add', label: 'без НДС — прибавить' },
                { value: 'extract', label: 'с НДС — выделить' },
              ]}
              onChange={(x) => setMode(x as 'add' | 'extract')}
            />
          </Field>
        </div>
        <Result label="Без НДС" value={fmt(v.net)} unit="₽" />
        <Result label="НДС" value={fmt(v.tax)} unit="₽" />
        <Result label="С НДС" value={fmt(v.gross)} unit="₽" />
      </Section>

      <Section title="Наценка и скидка">
        <div className="ip-pair">
          <Num label="Себестоимость, ₽" value={cost} onChange={setCost} />
          <Num label="Наценка, %" value={percent} onChange={setPercent} />
        </div>
        <Result label="Цена" value={fmt(calc.markup(num(cost), num(percent)))} unit="₽" />
        <div className="ip-pair">
          <Num label="Цена, ₽" value={price} onChange={setPrice} />
          <Num label="Скидка, %" value={disc} onChange={setDisc} />
        </div>
        <Result label="Со скидкой" value={fmt(calc.discount(num(price), num(disc)))} unit="₽" />
        {num(cost) > 0 && num(price) > 0 && (
          <Result label="Наценка от себестоимости до цены" value={fmt(calc.marginPercent(num(cost), num(price)))} unit="%" />
        )}
      </Section>

      <Section title="Разделить и сдача">
        <div className="ip-pair">
          <Num label="Сумма, ₽" value={total} onChange={setTotal} />
          <Num label="На сколько частей" value={parts} onChange={setParts} step="1" />
        </div>
        <Result label="Каждому" value={calc.split(num(total), Math.max(1, Math.floor(num(parts)))).map((p) => fmt(p)).join(' · ')} unit="₽" />
        <div className="ip-pair">
          <Num label="К оплате, ₽" value={due} onChange={setDue} />
          <Num label="Внесли, ₽" value={paid} onChange={setPaid} />
        </div>
        <Result label="Сдача" value={fmt(calc.change(num(paid), num(due)))} unit="₽" />
      </Section>

      <Section title="Курсы ЦБ">
        {rates.isLoading && <p className="hint">Загружаю курсы…</p>}
        {rates.isError && <div className="ip-error">{(rates.error as Error).message}</div>}
        {rates.data && (
          <>
            <p className="hint">
              ЦБ РФ на {rates.data.date}
              {rates.data.stale ? ' — свежие не получены, показан последний сохранённый' : ''}:{' '}
              {['USD', 'EUR', 'CNY'].map((c) => `${c} ${fmt(rates.data!.rates[c]?.value ?? 0, 4)} ₽`).join(' · ')}
            </p>
            <div className="ip-pair">
              <Num label={dir === 'to' ? `Сумма, ${cur}` : 'Сумма, ₽'} value={curAmount} onChange={setCurAmount} />
              <Field label="Валюта">
                <Select value={cur} options={curOptions} onChange={setCur} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={dir === 'from'} onChange={(e) => setDir(e.target.checked ? 'from' : 'to')} />
              Считать из рублей в валюту
            </label>
            {dir === 'to' ? (
              <Result label={`${cur} → ₽`} value={fmt(calc.toRub(num(curAmount), rateValue))} unit="₽" />
            ) : (
              <Result label={`₽ → ${cur}`} value={fmt(calc.fromRub(num(curAmount), rateValue))} unit={cur} />
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------ метраж */
function Area() {
  const [w, setW] = useState('2000');
  const [h, setH] = useState('1500');
  const [unit, setUnit] = useState('mm');
  const [perM2, setPerM2] = useState('');
  const [perM, setPerM] = useState('');
  const area = calc.areaM2(num(w), num(h), unit);
  const perim = calc.perimeterM(num(w), num(h), unit);

  const [qty, setQty] = useState('500');
  const [perSheet, setPerSheet] = useState('24');

  const [iw, setIw] = useState('500');
  const [ih, setIh] = useState('700');
  const [rqty, setRqty] = useState('10');
  const [roll, setRoll] = useState('1600');
  const [gap, setGap] = useState('10');
  const across = calc.acrossRoll(num(iw), num(roll), num(gap));

  return (
    <div className="calc-grid">
      <Section title="Площадь и периметр">
        <div className="ip-pair">
          <Num label="Ширина" value={w} onChange={setW} />
          <Num label="Высота" value={h} onChange={setH} />
          <Field label="Единица">
            <Select value={unit} options={LENGTH_OPTIONS.filter((o) => ['mm', 'cm', 'm'].includes(o.value))} onChange={setUnit} />
          </Field>
        </div>
        <Result label="Площадь" value={fmt(area, 4)} unit="м²" />
        <Result label="Периметр" value={fmt(perim, 3)} unit="м" />
        <div className="ip-pair">
          <Num label="Цена за м², ₽" value={perM2} onChange={setPerM2} />
          <Num label="Цена за пог. м, ₽" value={perM} onChange={setPerM} />
        </div>
        {num(perM2) > 0 && <Result label="Стоимость по площади" value={fmt(calc.round2(area * num(perM2)))} unit="₽" />}
        {num(perM) > 0 && <Result label="Стоимость по периметру" value={fmt(calc.round2(perim * num(perM)))} unit="₽" />}
      </Section>

      <Section title="Листы на тираж">
        <div className="ip-pair">
          <Num label="Тираж, шт" value={qty} onChange={setQty} step="1" />
          <Num label="На листе, шт" value={perSheet} onChange={setPerSheet} step="1" hint="сколько встаёт на лист — считает «Раскладка под печать»" />
        </div>
        <Result label="Листов" value={fmt(calc.sheetsFor(num(qty), num(perSheet)), 0)} />
      </Section>

      <Section title="Рулон: сколько метров">
        <div className="ip-pair">
          <Num label="Изделие: ширина, мм" value={iw} onChange={setIw} />
          <Num label="высота, мм" value={ih} onChange={setIh} />
        </div>
        <div className="ip-pair">
          <Num label="Штук" value={rqty} onChange={setRqty} step="1" />
          <Field label="Ширина рулона">
            <Select value={roll} options={ROLLS} onChange={setRoll} />
          </Field>
          <Num label="Зазор, мм" value={gap} onChange={setGap} />
        </div>
        <Result label="Поперёк рулона" value={fmt(across, 0)} unit="шт" />
        <Result label="Длина рулона" value={fmt(calc.rollLengthM(num(iw), num(ih), num(rqty), num(roll), num(gap)))} unit="м" />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------ дизайн */
function Design() {
  const [px, setPx] = useState('2480');
  const [dpi, setDpi] = useState('300');
  const [mm, setMm] = useState('210');
  const [sw, setSw] = useState('90');
  const [sh, setSh] = useState('50');
  const [nw, setNw] = useState('180');
  const [bleed, setBleed] = useState('2');
  const withBleed = calc.withBleed(num(sw), num(sh), num(bleed));
  return (
    <div className="calc-grid">
      <Section title="Пиксели ↔ миллиметры">
        <div className="ip-pair">
          <Num label="Пиксели" value={px} onChange={setPx} step="1" />
          <Num label="DPI" value={dpi} onChange={setDpi} step="1" />
          <Num label="Миллиметры" value={mm} onChange={setMm} />
        </div>
        <Result label={`${px || 0} px при ${dpi || 0} dpi`} value={fmt(calc.pxToMm(num(px), num(dpi)), 1)} unit="мм" />
        <Result label={`${mm || 0} мм при ${dpi || 0} dpi`} value={fmt(calc.mmToPx(num(mm), num(dpi)), 0)} unit="px" />
        <Result label={`${px || 0} px на ${mm || 0} мм — разрешение`} value={fmt(calc.dpiFor(num(px), num(mm)), 0)} unit="dpi" />
      </Section>
      <Section title="Пропорции и вылеты">
        <div className="ip-pair">
          <Num label="Ширина" value={sw} onChange={setSw} />
          <Num label="Высота" value={sh} onChange={setSh} />
          <Num label="Новая ширина" value={nw} onChange={setNw} />
        </div>
        <Result label="Новая высота" value={fmt(calc.scaleTo(num(sw), num(sh), num(nw)))} />
        <Num label="Вылет с каждой стороны, мм" value={bleed} onChange={setBleed} />
        <Result label="Размер с вылетами" value={`${fmt(withBleed.w)} × ${fmt(withBleed.h)}`} unit="мм" />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------ единицы */
function Units() {
  const [v, setV] = useState('1');
  const [from, setFrom] = useState('in');
  const [to, setTo] = useState('mm');
  const [wv, setWv] = useState('1500');
  const [wf, setWf] = useState('g');
  const [wt, setWt] = useState('kg');
  return (
    <div className="calc-grid">
      <Section title="Длина">
        <div className="ip-pair">
          <Num label="Значение" value={v} onChange={setV} />
          <Field label="Из">
            <Select value={from} options={LENGTH_OPTIONS} onChange={setFrom} />
          </Field>
          <Field label="В">
            <Select value={to} options={LENGTH_OPTIONS} onChange={setTo} />
          </Field>
        </div>
        <Result label={`${v || 0} ${calc.LENGTH_LABELS[from]}`} value={fmt(calc.convertLength(num(v), from, to), 4)} unit={calc.LENGTH_LABELS[to]} />
      </Section>
      <Section title="Вес">
        <div className="ip-pair">
          <Num label="Значение" value={wv} onChange={setWv} />
          <Field label="Из">
            <Select value={wf} options={WEIGHT_OPTIONS} onChange={setWf} />
          </Field>
          <Field label="В">
            <Select value={wt} options={WEIGHT_OPTIONS} onChange={setWt} />
          </Field>
        </div>
        <Result label={`${wv || 0} ${WEIGHT_OPTIONS.find((o) => o.value === wf)?.label}`} value={fmt(calc.convertWeight(num(wv), wf, wt), 4)} unit={WEIGHT_OPTIONS.find((o) => o.value === wt)?.label} />
      </Section>
    </div>
  );
}

export function CalcPage() {
  const [tab, setTab] = useState<Tab>('money');
  return (
    <main className="page scroll-page">
      <div className="page-inner calc">
        <Link className="page-back" to="/tools">
          ← Все инструменты
        </Link>
        <PageHead eyebrow="Инструменты" title="Калькулятор" sub="Деньги, метраж, размеры для дизайна и единицы — считается сразу при вводе." />
        <ToolsNotice />
        <div className="calc-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'calc-tab active' : 'calc-tab'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'money' && <Money />}
        {tab === 'area' && <Area />}
        {tab === 'design' && <Design />}
        {tab === 'units' && <Units />}
      </div>
    </main>
  );
}
