/* Знак «ПОСТЕР.» — тот же, что в шапке системы: приводочный крест и
   зелёная точка. Настоящий логотип заменит его, когда будет файл. */

export function RegMark() {
  return (
    <span className="reg" aria-hidden="true">
      <i />
    </span>
  );
}

export function SpotBar() {
  return (
    <span className="spotbar" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function Brand({ href = '/#top' }: { href?: string }) {
  return (
    <a className="brand" href={href} aria-label="ПОСТЕР — наверх">
      <RegMark />
      <span>
        ПОСТЕР<span className="dot">.</span>
        <small>реклама &amp; полиграфия</small>
      </span>
    </a>
  );
}
