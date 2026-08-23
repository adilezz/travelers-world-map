/** Small DOM helpers, and the live region. Nothing clever. */

type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      n.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') n.className = String(v);
    else if (k === 'text') n.textContent = String(v);
    else if (k === 'html') n.innerHTML = String(v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null) n.append(c as any);
  return n;
}

export const clear = (n: Element) => { while (n.firstChild) n.removeChild(n.firstChild); };

/** Marking announces the place, the new state, and the coverage change if any
 *  (doc 3 §11). One region, polite, so a fast sequence of taps does not shout
 *  over itself. */
let live: HTMLElement;
export function announce(msg: string) {
  if (!live) {
    live = el('div', { id: 'twm-live', class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.append(live);
  }
  // Re-setting identical text does not re-announce; a zero-width toggle does.
  live.textContent = live.textContent === msg ? msg + '​' : msg;
}

/** Score is 0-100 against the top place in the same country and is never
 *  comparable across borders (doc 1 §3). It is never rendered bare. */
export function scoreText(score: number, country: string): string {
  return score >= 100 ? `Top in ${country}` : `${score} of 100 in ${country}`;
}

export function fmtInt(n: number) { return n.toLocaleString('en-US'); }
