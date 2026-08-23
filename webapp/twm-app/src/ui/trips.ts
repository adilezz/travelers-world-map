/**
 * Trip planner. Collect → assign to days → see connected (doc 2 §9).
 * A day is a list, not a schedule. Drag to reorder. Straight-line distance
 * is the only travel fact we claim, and we say so.
 */
import { el, clear } from './dom';
import { haversine } from '../core/filters';
import { monthsInRange } from '../core/trips';
import type { Pin, Trip } from '../core/types';
import type { TripBook } from '../core/trips';

const FAR_KM = 400;

export interface TripHooks {
  open(id: string): void;
  hover(id: string | null): void;
  changed(): void;
}

export class TripPanel {
  constructor(
    private host: HTMLElement,
    private book: TripBook,
    private pinById: Map<string, Pin>,
    private hooks: TripHooks,
  ) {}

  render() {
    clear(this.host);
    const book = this.book;
    const head = el('div', { class: 'trip-head' },
      el('h2', { class: 'trip-title', text: 'Trips' }),
      el('button', {
        class: 'link-btn', type: 'button', text: 'New trip',
        onclick: () => { book.create('New trip'); this.hooks.changed(); },
      }),
    );
    this.host.append(head);

    if (!book.trips.length) {
      this.host.append(el('p', { class: 'muted small', text:
        'Save places, assign them to days, and see them connected. '
        + 'Straight lines, not routes — we do not invent travel times.' }));
      return;
    }

    this.host.append(el('div', { class: 'chips', role: 'tablist', 'aria-label': 'Trips' },
      ...book.trips.map((t) => el('button', {
        class: 'chip' + (t.id === book.activeId ? ' is-on' : ''),
        type: 'button', role: 'tab',
        'aria-selected': String(t.id === book.activeId),
        text: t.title || 'Untitled trip',
        onclick: () => { book.select(t.id); this.hooks.changed(); },
      })),
    ));

    const trip = book.active;
    if (!trip) return;
    this.host.append(this.editor(trip));
  }

  private editor(trip: Trip) {
    const wrap = el('div', { class: 'trip-editor' });
    wrap.append(el('input', {
      class: 'trip-name', type: 'text', value: trip.title,
      'aria-label': 'Trip name',
      onchange: (e: Event) => {
        this.book.rename(trip.id, (e.target as HTMLInputElement).value);
        this.hooks.changed();
      },
    }));

    wrap.append(el('div', { class: 'filter-row' },
      el('label', { class: 'passport-label', text: 'Dates' }),
      el('input', {
        type: 'date', value: trip.start ?? '',
        'aria-label': 'Start date',
        onchange: (e: Event) => {
          this.book.setDates(trip.id, (e.target as HTMLInputElement).value, trip.end);
          this.hooks.changed();
        },
      }),
      el('input', {
        type: 'date', value: trip.end ?? '',
        'aria-label': 'End date',
        onchange: (e: Event) => {
          this.book.setDates(trip.id, trip.start, (e.target as HTMLInputElement).value);
          this.hooks.changed();
        },
      }),
    ));

    wrap.append(el('p', { class: 'note', text:
      'Straight lines on the map, not routes. A long hop is flagged; a travel time is not invented.' }));

    const season = monthsInRange(trip.start, trip.end);
    const days = this.book.days(trip);
    for (const day of days) {
      wrap.append(this.dayList(trip, day, season));
    }
    wrap.append(el('button', {
      class: 'link-btn', type: 'button', text: 'Add a day',
      onclick: () => { this.book.addDay(); this.hooks.changed(); },
    }));

    const tray = trip.stops.filter((s) => s.day === 0)
      .sort((a, b) => a.position - b.position);
    wrap.append(this.list('Unassigned', 0, tray, season, true));

    wrap.append(el('button', {
      class: 'link-btn quiet', type: 'button', text: 'Delete this trip',
      onclick: () => { this.book.remove(trip.id); this.hooks.changed(); },
    }));
    return wrap;
  }

  private dayList(trip: Trip, day: number, season: Set<number>) {
    const stops = trip.stops.filter((s) => s.day === day)
      .sort((a, b) => a.position - b.position);
    return this.list(`Day ${day}`, day, stops, season, false);
  }

  private list(title: string, day: number, stops: { place_id: string; position: number }[],
               season: Set<number>, tray: boolean) {
    const ul = el('ul', {
      class: 'trip-list',
      'data-day': String(day),
      ondragover: (e: DragEvent) => { e.preventDefault(); },
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer?.getData('text/place-id');
        if (id) { this.book.move(id, day); this.hooks.changed(); }
      },
    });
    let prev: Pin | null = null;
    for (const s of stops) {
      const pin = this.pinById.get(s.place_id);
      if (!pin) {
        ul.append(el('li', { class: 'trip-missing' },
          el('span', { text: 'No longer in the database' }),
          el('span', { class: 'mono muted', text: s.place_id }),
        ));
        prev = null;
        continue;
      }
      const far = prev ? haversine({ lat: prev.lat, lon: prev.lon }, pin) : 0;
      const inSeason = !season.size || this.monthHit(pin.months, season);
      ul.append(this.row(pin, far, !tray && far > FAR_KM, season.size > 0 && !inSeason, day));
      prev = pin;
    }
    if (!stops.length) {
      ul.append(el('li', { class: 'trip-empty muted small', text: 'Drop a place here.' }));
    }
    return el('section', { class: 'trip-day' },
      el('h3', { text: title }),
      ul,
    );
  }

  private monthHit(mask: number, months: Set<number>) {
    if (!mask) return true; // unknown is not flagged as out of season
    for (const m of months) if (mask & (1 << (m - 1))) return true;
    return false;
  }

  private row(pin: Pin, km: number, far: boolean, offSeason: boolean, day: number) {
    const days = this.book.active ? this.book.days(this.book.active) : [1];
    const pick = el('select', {
      class: 'trip-day-pick',
      'aria-label': `Assign ${pin.name} to a day`,
      onchange: (e: Event) => {
        this.book.move(pin.id, Number((e.target as HTMLSelectElement).value));
        this.hooks.changed();
      },
    },
      el('option', { value: '0', selected: day === 0, text: 'Unassigned' }),
      ...days.map((d) => el('option', {
        value: String(d), selected: day === d, text: `Day ${d}`,
      })),
    ) as HTMLSelectElement;
    return el('li', {
      class: 'trip-stop'
        + (far ? ' is-far' : '')
        + (offSeason ? ' is-off-season' : ''),
      draggable: 'true',
      ondragstart: (e: DragEvent) => {
        e.dataTransfer?.setData('text/place-id', pin.id);
        e.dataTransfer!.effectAllowed = 'move';
      },
      onmouseenter: () => this.hooks.hover(pin.id),
      onmouseleave: () => this.hooks.hover(null),
      'data-id': pin.id,
    },
      el('button', {
        class: 'link-btn grow', type: 'button', text: pin.name,
        onclick: () => this.hooks.open(pin.id),
      }),
      pick,
      far
        ? el('span', { class: 'tag status-far', text: `${Math.round(km)} km · a long hop` })
        : km
          ? el('span', { class: 'mono muted', text: `${Math.round(km)} km` })
          : null,
      offSeason
        ? el('span', { class: 'tag status-season', text: 'Out of season' })
        : null,
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Remove ${pin.name}`,
        text: '✕',
        onclick: () => { this.book.drop(pin.id); this.hooks.changed(); },
      }),
    );
  }
}
