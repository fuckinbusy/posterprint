/* Поле «перетащите файл или выберите» — общее для утилит. Проверяет
   расширение и размер: файл больше предела на сервер не отправляется —
   гонять сотни мегабайт ради отказа незачем. Остальное проверит сервер и
   скажет понятно. */

import { useRef, useState } from 'react';

import { fileSize } from '@/lib/format';

export function FileDrop({
  accept,
  hint,
  maxBytes,
  onFile,
}: {
  accept: string;
  hint: string;
  /** предел размера; больше — красная надпись, без отправки */
  maxBytes?: number;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState('');

  const take = (file: File | undefined) => {
    if (!file) return;
    const ok = accept.split(',').some((ext) => file.name.toLowerCase().endsWith(ext.trim()));
    if (!ok) {
      setWrong(`Нужен файл ${accept}`);
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      setWrong(`Файл слишком большой: ${fileSize(file.size)}, предел — ${fileSize(maxBytes)}`);
      return;
    }
    setWrong('');
    onFile(file);
  };

  return (
    <div
      className={over ? 'file-drop over' : 'file-drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files[0]);
      }}
    >
      <p>{hint}</p>
      <button className="btn btn-ghost" type="button" onClick={() => input.current?.click()}>
        Выбрать файл
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {maxBytes && !wrong && <span className="file-drop-limit">до {fileSize(maxBytes)}</span>}
      {wrong && (
        <div className="file-drop-err" role="alert">
          {wrong}
        </div>
      )}
    </div>
  );
}
