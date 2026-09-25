// Проверка чистых функций калькулятора (web/src/features/tools/calc/calc.ts).
// Запускается из tests/test_calc_js.py через node с чтением .ts напрямую.
import assert from 'node:assert/strict';
import * as c from '../../web/src/features/tools/calc/calc.ts';

// деньги
assert.deepEqual(c.vat(1000, 22, 'add'), { net: 1000, tax: 220, gross: 1220 });
assert.deepEqual(c.vat(1220, 22, 'extract'), { net: 1000, tax: 220, gross: 1220 });
assert.deepEqual(c.vat(100, 20, 'extract'), { net: 83.33, tax: 16.67, gross: 100 });
assert.equal(c.markup(800, 25), 1000);
assert.equal(c.discount(1000, 15), 850);
assert.equal(c.marginPercent(800, 1000), 25);
assert.deepEqual(c.split(100, 3), [33.34, 33.33, 33.33]);
assert.equal(c.split(100, 3).reduce((a, b) => a + b, 0).toFixed(2), '100.00');
assert.deepEqual(c.split(10, 0), []);
assert.equal(c.change(5000, 4321.5), 678.5);
assert.equal(c.toRub(100, 84.9057), 8490.57);
assert.equal(c.fromRub(8490.57, 84.9057), 100);
assert.equal(c.fromRub(1, 0), 0);

// единицы
assert.equal(c.convertLength(1, 'in', 'mm'), 25.4);
assert.equal(c.convertLength(72, 'pt', 'in'), 1);
assert.equal(c.convertLength(2, 'm', 'cm'), 200);
assert.equal(c.convertWeight(1500, 'g', 'kg'), 1.5);
assert.throws(() => c.convertLength(1, 'mm', 'furlong'));

// метраж
assert.equal(c.areaM2(2000, 1500, 'mm'), 3);
assert.equal(c.areaM2(2, 1.5, 'm'), 3);
assert.equal(c.perimeterM(2000, 1500, 'mm'), 7);
assert.equal(c.sheetsFor(500, 24), 21);
assert.equal(c.sheetsFor(500, 0), 0);
assert.equal(c.acrossRoll(500, 1600, 10), 3);      // 3×500 + 2×10 = 1520 ≤ 1600; 4 не влезает
assert.equal(c.acrossRoll(2000, 1600, 0), 0);
assert.equal(c.rollLengthM(500, 700, 10, 1600, 10), 2.83);  // 4 ряда: 4×700 + 3×10 = 2830 мм

// дизайн
assert.equal(c.mmToPx(210, 300), 2480);
assert.equal(Math.round(c.pxToMm(2480, 300)), 210);
assert.equal(c.dpiFor(2480, 210), 300);
assert.equal(c.scaleTo(90, 50, 180), 100);
assert.deepEqual(c.withBleed(90, 50, 2), { w: 94, h: 54 });

console.log('calc ok');
