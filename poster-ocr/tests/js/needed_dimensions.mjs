/* Харнесс для сверки фронтовой копии правила с серверной.

   Читает случаи из JSON (его готовит tests/test_dimensions_parity.py),
   прогоняет через web/src/features/orders/dimensions.ts и печатает ответ
   в stdout. Ничего не знает про содержание случаев — сравнивает Python.

   Запускается на голом Node.js: dimensions.ts содержит только стираемые
   типы, а Node 22.6+ понимает такие файлы сам. Сборка не нужна. */

import { readFileSync } from 'node:fs';

import { contributes, neededDimensions } from '../../web/src/features/orders/dimensions.ts';

const { fields, cases } = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const answer = cases.map((params) => ({
  needed: [...neededDimensions(fields, params)].sort(),
  contributes: fields.map((field) => contributes(field, params)),
}));

process.stdout.write(JSON.stringify(answer));
