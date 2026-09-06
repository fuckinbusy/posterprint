/* Звук уведомления — без файлов, двумя нотами через Web Audio.

   Браузер не даёт играть звук, пока человек ни разу не трогал страницу:
   контекст звука создаётся «заглушённым» и просыпается только из-под
   жеста. Поэтому при первом же нажатии или клавише разблокируем его
   заранее (unlockAudio) — к моменту, когда придёт заказ, звук уже можно. */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Повесить один раз на старте: снимает блокировку звука первым жестом. */
export function unlockAudio(): () => void {
  const wake = () => {
    const c = context();
    if (c && c.state === 'suspended') void c.resume();
  };
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}

function tone(c: AudioContext, freq: number, at: number, length: number, volume: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // мягкая атака и спад — иначе щёлкает
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** Короткий двухнотный сигнал. Ничего не делает, если звук ещё заблокирован. */
export function playChime(): boolean {
  const c = context();
  if (!c || c.state !== 'running') return false;
  const now = c.currentTime;
  tone(c, 880, now, 0.18, 0.22);
  tone(c, 1318, now + 0.14, 0.26, 0.2);
  return true;
}
