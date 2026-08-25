/**
 * A small PDF writer that can actually print.
 *
 * What was here before produced a single uncompressed page, assembled as a
 * JavaScript string, with land simplified to a 480-point cap per ring and a
 * tolerance of about a degree at world scope — roughly 140 km of coastline
 * thrown away per step. It also measured stream lengths and cross-reference
 * offsets with `String.length`, which counts UTF-16 units rather than bytes:
 * correct only for as long as every byte in the file stays ASCII, and silently
 * corrupt the moment an image or an accented name arrives.
 *
 * This one is byte-exact throughout, compresses its streams, embeds JPEGs by
 * handing the encoder's own bytes to /DCTDecode without re-encoding, writes
 * many pages, and encodes text as WinAnsi so "Reykjavík" prints as itself.
 */

const enc = new TextEncoder();

/** ASCII/structure. Never used for anything that may carry a high byte. */
export function bytes(s: string): Uint8Array {
  return enc.encode(s);
}

/**
 * One char, one byte.
 *
 * Content streams are assembled as a JavaScript string and must be written
 * out as Latin-1, not UTF-8: WinAnsi puts "í" at byte 0xED, and UTF-8 would
 * write it as two bytes, shifting every cross-reference offset after it and
 * printing mojibake where a place name should be.
 */
export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as any).CompressionStream;
  if (!CS) return null;
  try {
    const s = new CS('deflate');       // zlib wrapper — exactly /FlateDecode
    const w = s.writable.getWriter();
    void w.write(data);
    void w.close();
    const chunks: Uint8Array[] = [];
    const r = s.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    return concat(chunks);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/** CP1252 positions 0x80–0x9F, which differ from Latin-1. */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/**
 * Encode for WinAnsiEncoding, and fold anything outside it rather than
 * replacing it with a question mark.
 *
 * A tile carrying "Ky?to" is worse than one carrying "Kyoto": the first reads
 * as a bug, the second as a transliteration. Latin diacritics survive intact
 * because WinAnsi has them; scripts it does not have are decomposed, and what
 * is left after that is dropped. Embedding a CID font for Han and Arabic is
 * the real answer and is not built.
 */
export function winAnsi(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d) { out.push(0x20); continue; }
    if (cp >= 0x20 && cp <= 0x7e) { out.push(cp); continue; }
    if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue; }
    const hi = CP1252_HIGH.indexOf(ch);
    if (hi >= 0) { out.push(0x80 + hi); continue; }
    // Strip the accent and try again; then give up on this character.
    const flat = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const f of flat) {
      const c = f.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    }
  }
  return new Uint8Array(out);
}

/** A PDF string literal, escaped, from already-encoded bytes. */
export function pdfString(s: string): Uint8Array {
  const raw = winAnsi(s);
  const out: number[] = [0x28];               // (
  for (const b of raw) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  out.push(0x29);                             // )
  return new Uint8Array(out);
}

/** Helvetica advance widths, /1000 em. Enough to centre a number in a tile. */
const HELV_W: Record<string, number> = {};
{
  const wide = 'MW@%';
  const mid = 'ABCDEFGHIJKLNOPQRSTUVXYZmw0123456789$&+<=>~';
  const narrow = "ijltfr.,:;'|![]()";
  for (let c = 32; c < 256; c++) {
    const ch = String.fromCharCode(c);
    HELV_W[ch] = wide.includes(ch) ? 900
      : narrow.includes(ch) ? 280
        : mid.includes(ch) ? 610
          : ch === ' ' ? 278 : 556;
  }
}

export function textWidth(s: string, sizePt: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += (HELV_W[ch] ?? 556) * (bold ? 1.06 : 1);
  return (w / 1000) * sizePt;
}

// ---------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------

export interface PageSpec {
  widthPt: number;
  heightPt: number;
  content: string;
  /** name -> image object id, referenced from the content as /name Do */
  images?: Record<string, number>;
  /** alpha values the page's content asks for, as /GAxx gs */
  alphas?: number[];
}

export class Pdf {
  /** Document title. Shows in the reader's title bar and its file properties. */
  title = '';
  subject = '';

  private objs: (Uint8Array | null)[] = [null];   // 1-based; index 0 unused
  private pages: { id: number; spec: PageSpec }[] = [];
  private deferred: { id: number; make: () => Promise<Uint8Array> }[] = [];

  private alloc(): number {
    this.objs.push(null);
    return this.objs.length - 1;
  }

  private set(id: number, body: Uint8Array) {
    this.objs[id] = body;
  }

  /**
   * Embed a JPEG by reference, not by value.
   *
   * /DCTDecode takes the encoder's own bytes, so a 5 MB relief crop stays
   * 5 MB instead of becoming 90 MB of raw samples that Flate then has to
   * chew through. This is what makes a 392 dpi wall map a sane file.
   */
  addJpeg(jpeg: Uint8Array, width: number, height: number): number {
    const id = this.alloc();
    const head = bytes(
      `${id} 0 obj << /Type /XObject /Subtype /Image /Width ${width}`
      + ` /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8`
      + ` /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    this.set(id, concat([head, jpeg, bytes('\nendstream\nendobj\n')]));
    return id;
  }

  addPage(spec: PageSpec) {
    const id = this.alloc();
    this.pages.push({ id, spec });
    const streamId = this.alloc();
    const raw = latin1(spec.content);
    this.deferred.push({
      id: streamId,
      make: async () => {
        // Small streams are left alone: Flate saves nothing worth having on a
        // 2 KB index page, and an uncompressed stream is one a person can read
        // in a text editor when something has gone wrong.
        const packed = raw.length > 8192 ? await deflate(raw) : null;
        const body = packed ?? raw;
        const filter = packed ? ' /Filter /FlateDecode' : '';
        return concat([
          bytes(`${streamId} 0 obj << /Length ${body.length}${filter} >>\nstream\n`),
          body,
          bytes('\nendstream\nendobj\n'),
        ]);
      },
    });
    (spec as any)._streamId = streamId;
  }

  async build(): Promise<Uint8Array> {
    for (const d of this.deferred) this.set(d.id, await d.make());

    const fontR = this.alloc();
    const fontB = this.alloc();
    this.set(fontR, bytes(
      `${fontR} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica`
      + ' /Encoding /WinAnsiEncoding >> endobj\n'));
    this.set(fontB, bytes(
      `${fontB} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold`
      + ' /Encoding /WinAnsiEncoding >> endobj\n'));

    const pagesId = this.alloc();
    for (const p of this.pages) {
      const imgs = p.spec.images ?? {};
      const xo = Object.entries(imgs)
        .map(([n, oid]) => `/${n} ${oid} 0 R`).join(' ');
      const gsPairs = [...new Set(p.spec.alphas ?? [])].map((a) => {
        const gid = this.alloc();
        this.set(gid, bytes(
          `${gid} 0 obj << /Type /ExtGState /ca ${a} /CA ${a} >> endobj\n`));
        return `/${alphaName(a)} ${gid} 0 R`;
      }).join(' ');
      this.set(p.id, bytes(
        `${p.id} 0 obj << /Type /Page /Parent ${pagesId} 0 R`
        + ` /MediaBox [0 0 ${p.spec.widthPt.toFixed(2)} ${p.spec.heightPt.toFixed(2)}]`
        + ` /Contents ${(p.spec as any)._streamId} 0 R /Resources <<`
        + ` /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >>`
        + (xo ? ` /XObject << ${xo} >>` : '')
        + (gsPairs ? ` /ExtGState << ${gsPairs} >>` : '')
        + ' /ProcSet [/PDF /Text /ImageC] >> >> endobj\n'));
    }
    this.set(pagesId, bytes(
      `${pagesId} 0 obj << /Type /Pages /Kids [`
      + this.pages.map((p) => `${p.id} 0 R`).join(' ')
      + `] /Count ${this.pages.length} >> endobj\n`));

    const catId = this.alloc();
    this.set(catId, bytes(
      `${catId} 0 obj << /Type /Catalog /Pages ${pagesId} 0 R >> endobj\n`));

    const infoId = this.alloc();
    const lit = (v: string) =>
      new TextDecoder('latin1').decode(pdfString(v));
    this.set(infoId, latin1(
      `${infoId} 0 obj << /Title ${lit(this.title)} /Subject ${lit(this.subject)}`
      + ' /Creator (Travelers World Map) /Producer (Travelers World Map) >> endobj\n'));

    const head = latin1('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
    const parts: Uint8Array[] = [head];
    const offset: number[] = new Array(this.objs.length).fill(0);
    let at = head.length;
    for (let i = 1; i < this.objs.length; i++) {
      const b = this.objs[i] ?? bytes(`${i} 0 obj null endobj\n`);
      offset[i] = at;
      parts.push(b);
      at += b.length;                       // bytes, not UTF-16 units
    }
    const xrefAt = at;
    let xref = `xref\n0 ${this.objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objs.length; i++) {
      xref += `${String(offset[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer << /Size ${this.objs.length} /Root ${catId} 0 R`
      + ` /Info ${infoId} 0 R >>\n`
      + `startxref\n${xrefAt}\n%%EOF\n`;
    parts.push(bytes(xref));
    return concat(parts);
  }
}

// ---------------------------------------------------------------------------
// a content stream, built as text
// ---------------------------------------------------------------------------

export const PT_PER_MM = 72 / 25.4;

export const alphaName = (a: number) => `GA${Math.round(a * 100)}`;

/** Two decimals is a hundredth of a point: about 3.5 microns on paper. */
export const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export class Content {
  private out: string[] = [];

  push(s: string) { this.out.push(s); return this; }

  toString() { return this.out.join('\n'); }

  save() { return this.push('q'); }

  restore() { return this.push('Q'); }

  fill(rgb: readonly number[]) {
    return this.push(`${rgb.map(n).join(' ')} rg`);
  }

  stroke(rgb: readonly number[]) {
    return this.push(`${rgb.map(n).join(' ')} RG`);
  }

  width(w: number) { return this.push(`${n(w)} w`); }

  dash(on: number, off: number) {
    return this.push(on > 0 ? `[${n(on)} ${n(off)}] 0 d` : '[] 0 d');
  }

  /** Constant alpha, via the page's ExtGState. Register the value in the
   *  page's `alphas` list or the viewer ignores it. */
  alpha(a: number) { return this.push(`/${alphaName(a)} gs`); }

  rect(x: number, y: number, w: number, h: number, op = 'f') {
    return this.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${op}`);
  }

  circle(x: number, y: number, r: number, op = 'f') {
    const k = r * 0.5522847498;
    return this.push([
      `${n(x + r)} ${n(y)} m`,
      `${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c`,
      `${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c`,
      `${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c`,
      `${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c`,
      op,
    ].join(' '));
  }

  /** Path from device-space points. Returns false when nothing was emitted. */
  poly(pts: number[][], close = true): boolean {
    if (pts.length < 2) return false;
    const parts: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      parts.push(`${n(pts[i][0])} ${n(pts[i][1])} ${i === 0 ? 'm' : 'l'}`);
    }
    if (close) parts.push('h');
    this.push(parts.join(' '));
    return true;
  }

  clipRect(x: number, y: number, w: number, h: number) {
    return this.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re W n`);
  }

  /** Place an image XObject in a w x h box at (x, y). */
  image(name: string, x: number, y: number, w: number, h: number) {
    return this.push(
      `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /${name} Do Q`);
  }

  text(s: string, x: number, y: number, size: number, opts: {
    bold?: boolean; align?: 'left' | 'centre' | 'right'; rgb?: readonly number[];
  } = {}) {
    if (!s) return this;
    const w = textWidth(s, size, opts.bold);
    const dx = opts.align === 'centre' ? -w / 2 : opts.align === 'right' ? -w : 0;
    if (opts.rgb) this.fill(opts.rgb);
    const lit = new TextDecoder('latin1').decode(pdfString(s));
    return this.push(
      `BT /${opts.bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(x + dx)} ${n(y)} Td ${lit} Tj ET`);
  }
}
