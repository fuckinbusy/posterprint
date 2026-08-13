/* =========================================================
   ПОСТЕР · макеты заказов
   Отдельный файл: подгружается только когда открывают заказ,
   чтобы не утяжелять основной скрипт.

   Наружу отдаёт window.PosterDesign с двумя методами:
     mount(container, orderId, options) — вставить блок макета
     unmount()                          — прибрать за собой
   ========================================================= */
(() => {
  'use strict';

  const API = '/api';

  /* ---------- вспомогательное ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const fileSize = (bytes) => {
    if (!bytes) return '';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
  };

  const dateTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  /* Настройки задаёт основной скрипт при вызове mount: как обращаться
     к API с токеном и как показывать уведомления. Так этот файл ничего
     не знает про устройство основного приложения. */
  let cfg = { request: null, toast: () => {}, onChange: () => {} };
  let current = { orderId: null, box: null, objectUrl: null };

  const ICONS = {
    file: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 17V4M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v13M6 11l6 6 6-6"/><path d="M4 21h16"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/></svg>',
  };

  /* ---------- разметка ---------- */
  function skeleton() {
    return `
      <div class="form-sec dz-sec">
        <h3><span class="reg"><i></i></span> Макет</h3>
        <div class="dz-body"><div class="dz-loading">Проверяю макет…</div></div>
      </div>`;
  }

  function emptyView(canUpload) {
    return `
      <div class="dz-empty ${canUpload ? 'droppable' : ''}" id="dzDrop">
        <span class="ic">${ICONS.file}</span>
        <b>Макет не загружен</b>
        ${canUpload
          ? `<span class="hint">Перетащите файл сюда или выберите на компьютере.<br>
               Файл CorelDRAW (.cdr). Имя присвоится по номеру заказа.</span>
             <button class="btn btn-ghost" id="dzPick" type="button">${ICONS.upload} Загрузить макет</button>`
          : '<span class="hint">Загрузить макет может сотрудник с соответствующим правом.</span>'}
      </div>`;
  }

  function loadedView(info, previewUrl, canUpload) {
    return `
      <div class="dz-card ${canUpload ? 'droppable' : ''}" id="dzDrop">
        <div class="dz-preview ${previewUrl ? '' : 'none'}" id="dzPreview">
          ${previewUrl
            ? `<img src="${previewUrl}" alt="Превью макета"><span class="dz-zoom">${ICONS.zoom}</span>`
            : `<span class="ic">${ICONS.file}</span>
               <span class="dz-nopreview">Превью недоступно</span>`}
        </div>
        <div class="dz-meta">
          <b>${esc(info.filename)}</b>
          <span class="dz-facts">${[fileSize(info.size), dateTime(info.uploaded_at)].filter(Boolean).join(' · ')}</span>
          ${previewUrl ? '' : `
            <span class="dz-note">
              В файле нет встроенного изображения — CorelDRAW сохраняет его,
              только если включена опция предпросмотра. Сам файл цел, его можно скачать.
            </span>`}
          <div class="dz-actions">
            <button class="btn btn-ghost" id="dzDownload" type="button">${ICONS.download} Скачать</button>
            ${canUpload ? `
              <button class="btn btn-ghost" id="dzReplace" type="button">${ICONS.upload} Заменить</button>
              <button class="btn btn-danger" id="dzDelete" type="button">${ICONS.trash}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- загрузка данных ---------- */
  async function refresh() {
    const box = current.box;
    if (!box) return;
    const body = box.querySelector('.dz-body');
    if (!body) return;

    let info;
    try {
      info = await cfg.request(`/orders/${current.orderId}/design`);
    } catch (e) {
      body.innerHTML = `<div class="dz-loading">${esc(e.message)}</div>`;
      return;
    }

    if (!info.exists) {
      body.innerHTML = emptyView(info.can_upload);
      bind(info);
      return;
    }

    // превью тянем отдельным запросом: его может не быть, и это нормально
    let previewUrl = null;
    try {
      const blob = await cfg.request(`/orders/${current.orderId}/design/preview`, { raw: true });
      if (blob) {
        releaseUrl();
        previewUrl = URL.createObjectURL(blob);
        current.objectUrl = previewUrl;
      }
    } catch (_) {
      previewUrl = null;
    }

    body.innerHTML = loadedView(info, previewUrl, info.can_upload);
    bind(info, previewUrl);
  }

  function releaseUrl() {
    if (current.objectUrl) {
      URL.revokeObjectURL(current.objectUrl);
      current.objectUrl = null;
    }
  }

  /* ---------- действия ---------- */
  async function upload(file) {
    if (!file) return;

    // проверяем на месте: незачем гнать на сервер файл, который он отклонит
    if (!/\.cdr$/i.test(file.name)) {
      cfg.toast('Принимаются только файлы CorelDRAW (.cdr)', true);
      return;
    }
    if (file.size > 300 * 1024 * 1024) {
      cfg.toast('Файл больше 300 МБ — столько сервер не примет', true);
      return;
    }

    const body = current.box.querySelector('.dz-body');
    body.innerHTML = `<div class="dz-loading">Загружаю «${esc(file.name)}»…</div>`;

    const form = new FormData();
    form.append('file', file);
    try {
      const info = await cfg.request(`/orders/${current.orderId}/design`, {
        method: 'POST',
        body: form,
      });
      cfg.toast(info.has_preview ? 'Макет загружен' : 'Макет загружен, но превью в нём нет');
      cfg.onChange();
    } catch (e) {
      cfg.toast(e.message, true);
    }
    refresh();
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cdr';
    input.addEventListener('change', () => upload(input.files[0]));
    input.click();
  }

  /** Скачивание: ссылка выдаётся сервером с коротким токеном.
   * Обычный <a href download> не отправляет заголовки с нашим токеном,
   * и сервер отвечал бы «нужен вход» — браузер показывал «Загрузка прервана». */
  async function download() {
    try {
      const link = await cfg.request(`/orders/${current.orderId}/design/link`);
      const a = document.createElement('a');
      a.href = link.url;
      a.download = link.filename || '';
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      cfg.toast(e.message, true);
    }
  }

  function bind(info, previewUrl) {
    const box = current.box;

    const pick = box.querySelector('#dzPick');
    if (pick) pick.addEventListener('click', pickFile);
    const replace = box.querySelector('#dzReplace');
    if (replace) replace.addEventListener('click', pickFile);

    const dl = box.querySelector('#dzDownload');
    if (dl) dl.addEventListener('click', download);

    const del = box.querySelector('#dzDelete');
    if (del) del.addEventListener('click', async () => {
      const ok = await cfg.confirm({
        eyebrow: 'Макет',
        title: 'Удалить макет?',
        text: `Файл <b>${esc(info.filename)}</b> будет удалён с сервера.`,
        note: 'Заказ и его история останутся.',
        yes: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      try {
        await cfg.request(`/orders/${current.orderId}/design`, { method: 'DELETE' });
        cfg.toast('Макет удалён');
        cfg.onChange();
      } catch (e) {
        cfg.toast(e.message, true);
      }
      refresh();
    });

    // увеличение превью
    const preview = box.querySelector('#dzPreview img');
    if (preview && previewUrl) {
      preview.parentElement.addEventListener('click', () => lightbox(previewUrl, info.filename));
    }

    // перетаскивание файла
    const drop = box.querySelector('#dzDrop.droppable');
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('over');
      }));
      drop.addEventListener('drop', (e) => {
        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) upload(file);
      });
    }
  }

  /* ---------- увеличение ---------- */
  function lightbox(url, title) {
    const layer = document.createElement('div');
    layer.className = 'dz-light';
    layer.innerHTML = `
      <div class="dz-light-bar">
        <span>${esc(title)}</span>
        <button type="button" aria-label="Закрыть">✕</button>
      </div>
      <img src="${url}" alt="${esc(title)}">`;
    document.body.append(layer);

    const close = () => {
      layer.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.tagName === 'BUTTON') close();
    });
    document.addEventListener('keydown', onKey, true);
  }

  /* ---------- наружу ---------- */
  window.PosterDesign = {
    mount(container, orderId, options = {}) {
      cfg = { ...cfg, ...options };
      current.orderId = orderId;
      container.insertAdjacentHTML('beforeend', skeleton());
      current.box = container.querySelector('.dz-sec');
      refresh();
    },
    unmount() {
      releaseUrl();
      current = { orderId: null, box: null, objectUrl: null };
    },
  };
})();