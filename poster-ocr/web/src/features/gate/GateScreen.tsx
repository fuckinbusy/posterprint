/* Экран выбора профиля — первое, что видит человек за рабочим местом.

   Плитки сотрудников плюс «Администратор». Профили, привязанные к другим
   компьютерам, показываются серыми с пометкой: человек за чужой машиной
   должен понимать, почему не видит свой профиль, а не думать, что тот
   пропал. */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { fetchProfiles } from '@/api/auth';
import { useAuth } from '@/app/AuthProvider';
import { errorText } from '@/app/ToastProvider';
import { LockIcon, PinIcon } from '@/components/Icons';
import { initials } from '@/lib/format';
import type { GateProfile } from '@/types/api';

/** Кого сейчас спрашиваем пароль. null — показываем список профилей. */
type PasswordTarget = { kind: 'admin'; name: string } | { kind: 'employee'; id: number; name: string };

export function GateScreen() {
  const { signInAdmin, signInEmployee } = useAuth();
  const [target, setTarget] = useState<PasswordTarget | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const profiles = useQuery({
    queryKey: ['auth', 'profiles'],
    queryFn: fetchProfiles,
    // список профилей нужен ровно сейчас и меняется редко
    staleTime: 30 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (target) passwordRef.current?.focus();
  }, [target]);

  const backToList = () => {
    setTarget(null);
    setPassword('');
    setError('');
  };

  /** Профиль без пароля — вход одним нажатием. */
  const enterWithoutPassword = async (employee: GateProfile) => {
    setBusy(true);
    setError('');
    try {
      await signInEmployee(employee.id, '');
    } catch (e) {
      // сюда попадаем, если профиль успели отключить или отвязать от места
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'admin') await signInAdmin(password);
      else await signInEmployee(target.id, password);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 401 ? 'Неверный пароль' : errorText(err));
      passwordRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  const device = profiles.data?.device;
  const deviceHint = device?.named
    ? `Этот компьютер: ${device.name}`
    : 'Этот компьютер ещё не назван — администратор может сделать это в разделе «Устройства».';

  return (
    <div className="gate">
      <div className="gate-box">
        <div className="gate-brand">
          ПОСТЕР<span className="dot">.</span>
        </div>
        <div className="spotbar" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <h1 className="gate-title">Кто работает?</h1>
        <p className="gate-sub">Выберите профиль — он запомнится на этом компьютере</p>
        <p className="gate-device">{profiles.data ? deviceHint : ''}</p>

        {!target && (
          <div className="gate-list">
            {profiles.isLoading && <div className="mx-empty">Загружаю профили…</div>}
            {profiles.isError && <div className="mx-empty">Сервер недоступен</div>}

            {profiles.data?.employees.map((employee) => (
              <button
                className={employee.available ? 'gate-card' : 'gate-card locked'}
                key={employee.id}
                type="button"
                disabled={!employee.available || busy}
                onClick={() => {
                  if (employee.has_password) {
                    setTarget({ kind: 'employee', id: employee.id, name: employee.name });
                  } else {
                    void enterWithoutPassword(employee);
                  }
                }}
              >
                <span className="av">{initials(employee.name)}</span>
                <b>{employee.name}</b>
                <span className="desc">{employee.note || 'Профиль сотрудника'}</span>
                {employee.available ? (
                  employee.has_password && (
                    <span className="lock">
                      <LockIcon />
                      пароль
                    </span>
                  )
                ) : (
                  <span className="lock pin">
                    <PinIcon />
                    другой компьютер
                  </span>
                )}
              </button>
            ))}

            {profiles.data && (
              <button
                className="gate-card admin"
                type="button"
                disabled={busy}
                onClick={() => setTarget({ kind: 'admin', name: 'Администратор' })}
              >
                <span className="av">А</span>
                <b>Администратор</b>
                <span className="desc">
                  Полный доступ: заказы, прайс, метрики, сотрудники и устройства.
                </span>
                <span className="lock">
                  <LockIcon />
                  пароль
                </span>
              </button>
            )}
          </div>
        )}

        {/* Ошибку входа без пароля показываем прямо под списком: своей формы
            у такого профиля нет, а молча ничего не делать нельзя. */}
        {!target && error && <div className="gate-pass-err">{error}</div>}

        {target && (
          <form className="gate-pass" onSubmit={submitPassword}>
            <div className="field">
              <label htmlFor="gatePassInput">Пароль · {target.name}</label>
              <input
                id="gatePassInput"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <div className="gate-pass-err">{error}</div>}
            <div className="gate-pass-row">
              <button className="btn btn-ghost" type="button" onClick={backToList}>
                Назад
              </button>
              <button className="btn btn-green" type="submit" disabled={busy}>
                Войти
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
