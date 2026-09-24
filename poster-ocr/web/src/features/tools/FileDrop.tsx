/* Поле «перетащите файл или выберите» — общее для утилит. Проверяет только
   расширение: всё остальное проверит сервер и скажет понятно. */

import { useRef, useState } from 'react';

export function FileDrop({ accept, hint, onFile }: { accept: string; hint: string; onFile: (file: File) => void }) {
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
      {wrong && <div className="file-drop-err">{wrong}</div>}
    </div>
  );
}
