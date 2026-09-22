/* Выгрузка CSV.

   Скачивание через ссылку не годится: у неё нет заголовка с токеном.
   Поэтому файл забираем как обычный запрос и отдаём браузеру уже готовым —
   через временную ссылку на blob. */

import { requestBlob } from './client';

export async function downloadCsv(path: string, filename: string): Promise<boolean> {
  const blob = await requestBlob(path);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // ссылку отпускаем не сразу: иначе браузер иногда не успевает начать скачивание
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
