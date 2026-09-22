/* Размер и поля страницы для печати.

   @page задаётся только из CSS, поэтому пока окно с документом открыто,
   в <head> висит правило под него. Живёт отдельно от окна печати заказа:
   касса печатается тем же способом. */

import { useEffect } from 'react';

export function usePageSize(size: string, margin = '14mm'): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-print-size', size);
    style.textContent = `@media print { @page { size: ${size}; margin: ${margin}; } }`;
    document.head.append(style);
    return () => style.remove();
  }, [size, margin]);
}
