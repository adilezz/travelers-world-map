/**
 * Account sheet. Optional. Not a wall (doc 2 §10, doc 5 §6).
 *
 * Magic link and Google are linked identities on one user. The accent is not
 * used — it means visited and nothing else (P8).
 */
import { el, clear, announce } from './dom';
import type { Session, MergedRecord } from '../core/session';
import type { Profile } from '../core/record';
import type { Trip, Visit } from '../core/types';

export interface AccountHooks {
  payload(): { visits: Visit[]; trips: Trip[]; profile: Profile };
  applyMerged(rec: MergedRecord): void;
  exportLocal(): void;
  signedIn(): void;
  signedOut(): void;
}

export class AccountSheet {
  private root: HTMLElement | null = null;
  private exported = false;
  private busy = false;

  constructor(private session: Session, private hooks: AccountHooks) {}

  open() {
    if (this.root) { this.root.remove(); this.root = null; }
    this.exported = false;
    this.root = el('div', { class: 'account-root', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'account-title' });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    document.body.append(this.root);
    void this.paint();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }

  get isOpen() { return !!this.root; }

  async paint() {
    if (!this.root) return;
    clear(this.root);
    await this.session.refreshConfig();
    const card = el('div', { class: 'account-card' });
    const close = el('button', {
      class: 'icon-btn account-close', type: 'button',
      'aria-label': 'Close account', text: '×',
      onclick: () => this.close(),
    });
    card.append(close);
    if (this.session.signedIn) this.paintSignedIn(card);
    else this.paintSignedOut(card);
    this.root.append(card);
    const focus = card.querySelector<HTMLElement>('input, button.link-btn, button.primary');
    focus?.focus();
  }

  private paintSignedOut(card: HTMLElement) {
    card.append(
      el('p', { class: 'account-kicker', text: 'Optional' }),
      el('h2', { id: 'account-title', class: 'account-title', text: 'Keep this record' }),
      el('p', { class: 'account-copy', text:
        'The map works without an account. Sign in to keep marks across devices. '
        + 'Signing in merges what is already on this browser — nothing is replaced.' }),
    );
    const email = el('input', {
      id: 'account-email', type: 'email', autocomplete: 'email',
      placeholder: 'you@example.com', 'aria-label': 'Email',
    }) as HTMLInputElement;
    const status = el('p', { class: 'account-status', role: 'status' });
    const send = el('button', {
      class: 'primary', type: 'button', text: 'Email a sign-in link',
      onclick: () => void this.sendMagic(email.value, status, send),
    });
    const field = el('label', { class: 'account-label' }, 'Email', email);
    card.append(field, send, status);
    if (this.session.config.google && !this.session.config.dev) {
      const g = el('button', {
        class: 'link-btn', type: 'button', text: 'Continue with Google',
        onclick: () => { window.location.href = this.session.googleStartUrl(); },
      });
      card.append(g);
    }
    card.append(el('p', { class: 'account-copy muted', text:
      'No password. A further sign-in method attaches to the same user, not a second one.' }));
  }

  private paintSignedIn(card: HTMLElement) {
    const user = this.session.user!;
    const providers = (user.providers || []).join(', ') || 'email';
    card.append(
      el('p', { class: 'account-kicker', text: 'Signed in' }),
      el('h2', { id: 'account-title', class: 'account-title',
        text: user.email || 'Your account' }),
      el('p', { class: 'account-copy', text: `Linked: ${providers}.` }),
      el('p', { class: 'account-copy', text:
        'Signing out keeps the copy in this browser. The queue pauses until you sign in again.' }),
      el('button', {
        class: 'link-btn', type: 'button', text: 'Sign out',
        onclick: () => void this.doSignOut(),
      }),
      el('h3', { class: 'account-sub', text: 'Delete the server copy' }),
      el('p', { class: 'account-copy', text:
        `This removes rows on the server. The copy in this browser stays. `
        + `Backups are cleared within ${this.session.deletionBackupDays} days. `
        + 'Export a file first.' }),
    );
    const del = el('button', {
      class: 'link-btn', type: 'button', text: 'Delete the server copy',
      disabled: true,
      onclick: () => void this.doDelete(del),
    }) as HTMLButtonElement;
    const exp = el('button', {
      class: 'primary', type: 'button', text: 'Export a copy first',
      onclick: () => {
        this.hooks.exportLocal();
        this.exported = true;
        del.disabled = false;
        announce('Exported. You can delete the server copy.');
      },
    });
    card.append(exp, del);
  }

  private async sendMagic(email: string, status: HTMLElement, send: HTMLButtonElement) {
    if (this.busy) return;
    const addr = email.trim();
    if (!addr.includes('@')) {
      status.textContent = 'An email address is needed.';
      return;
    }
    this.busy = true;
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const out = await this.session.requestMagicLink(addr);
      if (out.dev_token) {
        status.textContent = 'Signing in…';
        await this.finish(out.dev_token);
        return;
      }
      status.textContent = 'Check your email for a sign-in link. This window can stay open.';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      send.disabled = false;
    }
  }

  async finish(token: string) {
    const payload = this.hooks.payload();
    const rec = await this.session.consumeMagic(token, payload);
    this.hooks.applyMerged(rec);
    this.hooks.signedIn();
    announce(`Signed in as ${rec.user.email || 'your account'}. Marks from this browser were kept.`);
    await this.paint();
  }

  private async doSignOut() {
    await this.session.signOut();
    this.hooks.signedOut();
    announce('Signed out. Marks in this browser are still here.');
    await this.paint();
  }

  private async doDelete(btn: HTMLButtonElement) {
    if (!this.exported) return;
    btn.disabled = true;
    try {
      const out = await this.session.deleteAccount();
      this.hooks.signedOut();
      announce(
        `Server copy removed. Backups are cleared within ${out.backups_within_days} days. `
        + 'This browser still has your marks.',
      );
      await this.paint();
    } catch (err) {
      btn.disabled = false;
      announce(err instanceof Error ? err.message : String(err));
    }
  }
}
