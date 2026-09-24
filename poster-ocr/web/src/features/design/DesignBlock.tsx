/* Макет заказа: превью, загрузка, замена, скачивание, удаление.

   Превью берётся из самого файла CorelDRAW. Его может не быть — CorelDRAW
   сохраняет эскиз, только если включена соответствующая опция. Это не
   ошибка: файл цел, просто картинки внутри нет, и карточка говорит об этом
   прямо. */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  MAX_DESIGN_BYTES,
  deleteDesign,
  fetchDesignLink,
  fetchDesignPreview,
  uploadDesign,
  useDesignInfo,
} from '@/api/designs';
import { apiHref } from '@/api/client';
import { qk } from '@/api/keys';
import { useCan } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { useToast } from '@/app/ToastProvider';
import { DownloadIcon, FileIcon, OpenIcon, TrashIcon, UploadIcon, ZoomIcon } from '@/components/Icons';
import { Section } from '@/components/ui';
import { dtFullRu, fileSize } from '@/lib/format';
import type { DesignInfo } from '@/types/api';

import { DesignViewer } from './DesignViewer';
import { Lightbox } from './Lightbox';

export function DesignBlock({ orderId }: { orderId: number }) {
  const can = useCan();
  const info = useDesignInfo(orderId, can('design.view'));

  if (!can('design.view')) return null;

  return (
    <Section title="Макет">
      {info.isLoading && <div className="dz-loading">Проверяю макет…</div>}
      {info.isError && <div className="dz-loading">{(info.error as Error).message}</div>}
      {info.data && <DesignBody orderId={orderId} info={info.data} />}
    </Section>
  );
}

function DesignBody({ orderId, info }: { orderId: number; info: DesignInfo }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const askConfirm = useConfirm();

  const [preview, setPreview] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Превью тянется отдельным запросом и живёт как объектная ссылка —
   * её обязательно освобождать, иначе картинки копятся в памяти вкладки,
   * пока человек ходит по заказам. */
  useEffect(() => {
    if (!info.exists || !info.has_preview) {
      setPreview(null);
      return undefined;
    }
    let url: string | null = null;
    let cancelled = false;

    void fetchDesignPreview(orderId).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPreview(url);
    });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [orderId, info.exists, info.has_preview, info.uploaded_at]);

  /** После загрузки и удаления в истории заказа появляется запись —
   *  перечитываем и её, не только сведения о файле. */
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.design(orderId) });
    qc.invalidateQueries({ queryKey: qk.order(orderId) });
  };

  const upload = async (file: File | null | undefined) => {
    if (!file) return;

    // проверяем на месте: незачем гнать на сервер файл, который он отклонит
    if (!/\.cdr$/i.test(file.name)) {
      toast('Принимаются только файлы CorelDRAW (.cdr)');
      return;
    }
    if (file.size > MAX_DESIGN_BYTES) {
      toast('Файл больше 300 МБ — столько сервер не примет');
      return;
    }

    setBusy(`Загружаю «${file.name}»…`);
    try {
      const result = await uploadDesign(orderId, file);
      toast(result.has_preview ? 'Макет загружен' : 'Макет загружен, но превью в нём нет');
      refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  const pickFile = () => fileInput.current?.click();

  /** Скачивание идёт по ссылке с коротким токеном: обычный <a download>
   *  не отправляет наши заголовки, и сервер ответил бы «нужен вход». */
  const download = async () => {
    try {
      const link = await fetchDesignLink(orderId);
      const a = document.createElement('a');
      a.href = apiHref(link.url);
      a.download = link.filename || '';
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    const ok = await askConfirm({
      eyebrow: 'Макет',
      title: 'Удалить макет?',
      text: (
        <>
          Файл <b>{info.filename}</b> будет удалён с сервера.
        </>
      ),
      note: 'Заказ и его история останутся.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteDesign(orderId);
      toast('Макет удалён');
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const dropProps = info.can_upload
    ? {
        onDragEnter: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        },
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer?.files[0]);
        },
      }
    : {};

  const dropClass = (base: string) =>
    [base, info.can_upload ? 'droppable' : '', dragOver ? 'over' : ''].filter(Boolean).join(' ');

  if (busy) return <div className="dz-loading">{busy}</div>;

  return (
    <>
      <input
        type="file"
        accept=".cdr"
        ref={fileInput}
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          // сбрасываем, иначе повторный выбор того же файла не сработает
          e.target.value = '';
        }}
      />

      {!info.exists ? (
        <div className={dropClass('dz-empty')} {...dropProps}>
          <span className="ic">
            <FileIcon />
          </span>
          <b>Макет не загружен</b>
          {info.can_upload ? (
            <>
              <span className="hint">
                Перетащите файл сюда или выберите на компьютере.
                <br />
                Файл CorelDRAW (.cdr). Имя присвоится по номеру заказа.
              </span>
              <button className="btn btn-ghost" type="button" onClick={pickFile}>
                <UploadIcon /> Загрузить макет
              </button>
            </>
          ) : (
            <span className="hint">
              Загрузить макет может сотрудник с соответствующим правом.
            </span>
          )}
        </div>
      ) : (
        <div className={dropClass('dz-card')} {...dropProps}>
          <div className={preview ? 'dz-preview' : 'dz-preview none'}>
            {preview ? (
              <>
                <img src={preview} alt="Превью макета" onClick={() => setZoomed(true)} />
                <span className="dz-zoom" onClick={() => setZoomed(true)}>
                  <ZoomIcon />
                </span>
              </>
            ) : (
              <>
                <span className="ic">
                  <FileIcon />
                </span>
                <span className="dz-nopreview">Превью недоступно</span>
              </>
            )}
          </div>

          <div className="dz-meta">
            <b>{info.filename}</b>
            <span className="dz-facts">
              {[fileSize(info.size), dtFullRu(info.uploaded_at)].filter(Boolean).join(' · ')}
            </span>
            {!preview && (
              <span className="dz-note">
                В файле нет встроенного изображения — CorelDRAW сохраняет его, только если включена
                опция предпросмотра. Сам файл цел, его можно скачать.
              </span>
            )}
            <div className="dz-actions">
              <button
                className="btn btn-ghost"
                type="button"
                title="Содержимое макета: двигать, приближать, смотреть размеры объектов"
                onClick={() => setViewing(true)}
              >
                <OpenIcon /> Открыть макет
              </button>
              <button className="btn btn-ghost" type="button" onClick={download}>
                <DownloadIcon /> Скачать
              </button>
              {info.can_upload && (
                <>
                  <button className="btn btn-ghost" type="button" onClick={pickFile}>
                    <UploadIcon /> Заменить
                  </button>
                  <button className="btn btn-danger" type="button" onClick={remove}>
                    <TrashIcon />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {viewing && info.exists && (
        <DesignViewer
          source={{ kind: 'order', orderId }}
          title={info.filename}
          thumbnail={preview}
          onClose={() => setViewing(false)}
        />
      )}

      {zoomed && preview && (
        <Lightbox url={preview} title={info.filename} onClose={() => setZoomed(false)} />
      )}
    </>
  );
}
