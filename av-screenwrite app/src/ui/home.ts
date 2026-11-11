/** Главный экран: список проектов в виде карточек. */
import type { ProjectMeta } from '../library';
import { formatTime } from '../core/time';
import { getLocale, t, tp } from '../i18n';

export interface HomeHandlers {
  open(id: string): void;
  duplicate(id: string): void;
  exportFile(id: string): void;
  remove(id: string): void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const icon = (name: string) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function when(ms: number): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function cardHTML(p: ProjectMeta): string {
  const name = p.title.trim() || t('app.untitled');
  const bad = !!p.error || !!p.tooNew;
  const sub = [p.author.trim(), p.date.trim()].filter(Boolean).join(' · ');
  const actions = [
    !bad ? `<button type="button" data-act="duplicate" title="${esc(t('card.dup'))}" aria-label="${esc(t('card.dup'))}">${icon('copy')}</button>` : '',
    !bad ? `<button type="button" data-act="export" title="${esc(t('card.export'))}" aria-label="${esc(t('card.export'))}">${icon('download')}</button>` : '',
    `<button type="button" class="del" data-act="remove" title="${esc(t('card.delete'))}" aria-label="${esc(t('card.delete'))}">${icon('trash')}</button>`,
  ].join('');
  const body = bad
    ? `<span class="card-err">${esc(p.tooNew ? t('home.tooNew') : t('home.damaged'))}</span>` +
      (p.error ? `<span class="card-sub">${esc(p.error)}</span>` : '')
    : (sub ? `<span class="card-sub">${esc(sub)}</span>` : '') +
      `<span class="card-foot"><span class="card-dur">${icon('clock')}${esc(formatTime(p.seconds))}</span>` +
      `<span class="card-stats">${esc(
        t('home.counts', {
          rows: p.rows,
          rowsUnit: tp('unit.row', p.rows),
          words: p.words,
          wordsUnit: tp('unit.word', p.words),
        }),
      )}</span></span>`;
  return (
    `<article class="card${bad ? ' damaged' : ''}" data-id="${p.id}">` +
    `<button type="button" class="card-main" data-act="open" ${bad ? 'disabled' : ''} aria-label="${esc(t('card.open'))}: ${esc(name)}">` +
    `<span class="card-title${p.title.trim() ? '' : ' untitled'}">${esc(name)}</span>${body}` +
    `<span class="card-date">${esc(t('home.modified', { when: when(p.modified) }))}</span></button>` +
    `<div class="card-actions">${actions}</div></article>`
  );
}

export class Home {
  private all: ProjectMeta[] = [];
  private loaded = false;

  constructor(
    private readonly listEl: HTMLElement,
    private readonly emptyEl: HTMLElement,
    private readonly searchEl: HTMLInputElement,
    handlers: HomeHandlers,
  ) {
    listEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      const id = btn?.closest<HTMLElement>('.card')?.dataset.id;
      if (!btn || !id || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === 'open') handlers.open(id);
      else if (act === 'duplicate') handlers.duplicate(id);
      else if (act === 'export') handlers.exportFile(id);
      else if (act === 'remove') handlers.remove(id);
    });
    searchEl.addEventListener('input', () => this.render());
  }

  setProjects(list: ProjectMeta[]): void {
    this.all = list;
    this.loaded = true;
    this.render();
  }

  /** Перерисовать (после смены языка или ввода в поиск). */
  render(): void {
    const q = this.searchEl.value.trim().toLowerCase();
    const shown = q
      ? this.all.filter((p) => `${p.title} ${p.author}`.toLowerCase().includes(q) || (!p.title.trim() && t('app.untitled').toLowerCase().includes(q)))
      : this.all;
    this.listEl.innerHTML = shown.map(cardHTML).join('');
    const empty = this.loaded && shown.length === 0;
    this.emptyEl.hidden = !empty;
    const count = document.getElementById('homeCount');
    if (count) {
      count.hidden = this.all.length === 0;
      count.textContent = q ? `${shown.length} / ${this.all.length}` : String(this.all.length);
    }
    if (empty) {
      document.getElementById('homeEmptyTitle')!.textContent = this.all.length ? t('home.nothingFound') : t('home.empty');
      document.getElementById('homeEmptyHint')!.textContent = this.all.length ? '' : t('home.emptyHint');
    }
  }
}
