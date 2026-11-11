import { t } from '../i18n';

export interface DialogButton<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

/** Модальный диалог. Esc или закрытие → 'cancel'. */
export function choose<T extends string>(
  title: string,
  text: string,
  buttons: DialogButton<T>[],
): Promise<T | 'cancel'> {
  const dlg = document.getElementById('dlg') as HTMLDialogElement;
  const actions = document.getElementById('dlgActions')!;
  document.getElementById('dlgTitle')!.textContent = title;
  document.getElementById('dlgText')!.textContent = text;
  actions.textContent = '';

  return new Promise((resolve) => {
    let result: T | 'cancel' = 'cancel';
    let primary: HTMLButtonElement | null = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => {
        result = b.id;
        dlg.close();
      });
      if (b.primary) primary = el;
      actions.append(el);
    }
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
    primary?.focus();
  });
}

export function showError(title: string, message: string): Promise<void> {
  return choose(title, message, [{ id: 'ok', label: t('dlg.ok'), primary: true }]).then(() => undefined);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Короткое сообщение внизу окна; с `action` — ещё и кнопка (например, «Вернуть»). */
export function toast(msg: string, opts: { ms?: number; action?: { label: string; run: () => void } } = {}): void {
  const el = document.getElementById('toast')!;
  const text = document.getElementById('toastMsg')!;
  const btn = document.getElementById('toastAct') as HTMLButtonElement;
  text.textContent = msg;
  btn.hidden = !opts.action;
  if (opts.action) {
    btn.textContent = opts.action.label;
    btn.onclick = () => {
      el.classList.remove('show');
      opts.action!.run();
    };
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.ms ?? (opts.action ? 8000 : 4000));
}
