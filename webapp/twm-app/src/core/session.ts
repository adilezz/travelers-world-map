/**
 * Account session and the user-service client.
 *
 * Place files are never fetched from here (doc 4 §1). Secrets for Google
 * never reach this module — the browser only holds a session token.
 */
import type { Trip, Visit } from './types';
import type { Profile } from './record';

const KEY = 'twm.session.v1';

export interface AuthUser {
  id: string;
  email?: string | null;
  providers: string[];
}

export interface AuthConfig {
  magic: boolean;
  google: boolean;
  dev: boolean;
  deletion_backup_days: number;
}

export interface MergedRecord {
  session: string;
  user: AuthUser;
  visits: Visit[];
  trips: Trip[];
  profile: Profile;
  deletion_backup_days?: number;
}

export function apiRoot(): string {
  try {
    const ls = localStorage.getItem('twm.api');
    if (ls) return ls.replace(/\/$/, '');
  } catch { /* private mode */ }
  const env = import.meta.env.VITE_TWM_API as string | undefined;
  if (typeof env === 'string' && env) return env.replace(/\/$/, '');
  return '/api';
}

export class Session {
  token: string | null = null;
  user: AuthUser | null = null;
  /** Sign-out pauses the queue. Local marks stay (doc 5 §6). */
  paused = true;
  deletionBackupDays = 30;
  config: AuthConfig = { magic: true, google: false, dev: false, deletion_backup_days: 30 };

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const doc = JSON.parse(raw);
        this.token = doc.token ?? null;
        this.user = doc.user ?? null;
      }
    } catch { /* */ }
    this.paused = !this.token;
  }

  get signedIn() { return !!this.token && !!this.user; }

  remember(token: string, user: AuthUser, backupDays?: number) {
    this.token = token;
    this.user = user;
    this.paused = false;
    if (backupDays) this.deletionBackupDays = backupDays;
    this.persist();
  }

  /** Local copy stays. Queue pauses. */
  clear() {
    this.token = null;
    this.user = null;
    this.paused = true;
    try { localStorage.removeItem(KEY); } catch { /* */ }
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ token: this.token, user: this.user }));
    } catch { /* */ }
  }

  async refreshConfig() {
    try {
      const r = await fetch(apiRoot() + '/auth/config', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      this.config = await r.json();
      this.deletionBackupDays = this.config.deletion_backup_days ?? 30;
    } catch { /* account service optional; the product works without it */ }
  }

  async requestMagicLink(email: string): Promise<{ sent: boolean; dev_token?: string }> {
    return this.post('/auth/magic-link', { email });
  }

  async consumeMagic(token: string, payload: {
    visits: Visit[]; trips: Trip[]; profile: Profile;
  }): Promise<MergedRecord> {
    const rec = await this.post('/auth/session', { token, ...payload }) as MergedRecord;
    this.remember(rec.session, rec.user, rec.deletion_backup_days);
    return rec;
  }

  async googleDev(email: string, sub: string, payload: {
    visits: Visit[]; trips: Trip[]; profile: Profile;
  }): Promise<MergedRecord> {
    const rec = await this.post('/auth/google', { email, sub, ...payload }) as MergedRecord;
    this.remember(rec.session, rec.user, rec.deletion_backup_days);
    return rec;
  }

  googleStartUrl() {
    return apiRoot() + '/auth/google';
  }

  async pullMerge(payload: { visits: Visit[]; trips: Trip[]; profile: Profile }) {
    return this.request('POST', '/import', payload) as Promise<{
      visits: Visit[]; trips: Trip[]; profile: Profile;
    }>;
  }

  async me() {
    return this.request('GET', '/auth/me') as Promise<AuthUser>;
  }

  async putVisit(v: Visit) {
    if (!this.token || this.paused) return;
    await this.request('PUT', `/visits/${encodeURIComponent(v.place_id)}`, v);
  }

  async putTrip(t: unknown) {
    if (!this.token || this.paused) return;
    await this.request('POST', '/trips', t);
  }

  async signOut() {
    const token = this.token;
    this.clear();
    if (!token) return;
    try {
      await this.request('POST', '/auth/logout', {}, token);
    } catch { /* local sign-out already happened */ }
  }

  async exportServer(): Promise<unknown> {
    return this.request('GET', '/export');
  }

  async deleteAccount(): Promise<{ deleted: boolean; backups_within_days: number }> {
    const out = await this.request('DELETE', '/account') as {
      deleted: boolean; backups_within_days: number;
    };
    this.clear();
    return out;
  }

  private async post(path: string, body: unknown) {
    return this.request('POST', path, body);
  }

  private async request(method: string, path: string, body?: unknown, token = this.token): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(apiRoot() + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('The account service is not reachable. Marks in this browser are kept.');
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data?.error || `Account service returned ${res.status}`);
    return data;
  }
}
