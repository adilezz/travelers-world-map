/**
 * A real .xlsx (Office Open XML), readable without this product.
 * Not HTML wearing the extension (doc 5 §8.1).
 */
import { zipStore } from './zip';

export const ROW_CAP = 10_000;
export const ROW_CAP_COPY =
  'Above 10,000 rows the file becomes slow to open. Narrow the filter, or export in two passes.';

export const SHEET_COLUMNS = [
  'name', 'country', 'region', 'lat', 'lon', 'kinds', 'score',
  'visited', 'visited_on', 'note', 'WHS', 'sources', 'place_id',
] as const;

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string | number>;

const enc = new TextEncoder();
const xml = (s: string) => enc.encode(s);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(i: number): string {
  let n = i + 1, s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function buildXlsx(rows: SheetRow[]): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const intern = (s: string) => {
    const hit = index.get(s);
    if (hit !== undefined) return hit;
    const i = strings.length;
    strings.push(s);
    index.set(s, i);
    return i;
  };
  for (const h of SHEET_COLUMNS) intern(h);
  for (const row of rows) {
    for (const h of SHEET_COLUMNS) {
      const v = row[h];
      if (typeof v === 'string') intern(v);
    }
  }

  const cell = (r: number, c: number, v: string | number) => {
    const ref = `${colName(c)}${r}`;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return `<c r="${ref}" t="n"><v>${v}</v></c>`;
    }
    return `<c r="${ref}" t="s"><v>${intern(String(v))}</v></c>`;
  };

  const sheetRows: string[] = [];
  sheetRows.push(`<row r="1">${SHEET_COLUMNS.map((h, c) => cell(1, c, h)).join('')}</row>`);
  rows.forEach((row, i) => {
    const r = i + 2;
    sheetRows.push(`<row r="${r}">${SHEET_COLUMNS.map((h, c) => cell(r, c, row[h])).join('')}</row>`);
  });

  const sst = strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('');
  const lastCol = colName(SHEET_COLUMNS.length - 1);
  const lastRow = rows.length + 1;

  const files = [
    { name: '[Content_Types].xml', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + `</Types>`,
    ) },
    { name: '_rels/.rels', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`,
    ) },
    { name: 'xl/_rels/workbook.xml.rels', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
      + `</Relationships>`,
    ) },
    { name: 'xl/workbook.xml', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
      + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets><sheet name="Places" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ) },
    { name: 'xl/styles.xml', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
      + `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>`
      + `<borders count="1"><border/></borders>`
      + `<cellStyleXfs count="1"><xf/></cellStyleXfs>`
      + `<cellXfs count="1"><xf/></cellXfs>`
      + `</styleSheet>`,
    ) },
    { name: 'xl/sharedStrings.xml', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">`
      + `${sst}</sst>`,
    ) },
    { name: 'xl/worksheets/sheet1.xml', data: xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<dimension ref="A1:${lastCol}${lastRow}"/>`
      + `<sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    ) },
  ];
  return zipStore(files);
}
