// Reads spreadsheets into rows of text: Excel .xlsx files, and CSV or tab-separated text.
// No libraries: an .xlsx file is a ZIP of XML files, which the browser can unpack itself.
// The server uses the same ZIP reader to open Anki packages.

// ---- ZIP --------------------------------------------------------------------

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const utf8 = new TextDecoder();

/** Map of file name to a function returning that file's bytes. `kind` names the file in errors. */
export function readZip(buffer, kind = '.xlsx') {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The directory of files sits at the end of the archive.
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= 0 && i >= buffer.byteLength - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`This is not a valid ${kind} file.`);

  const files = new Map();
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    files.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in ${kind} file.`);
      return method === 8 ? inflate(data) : data;
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ---- XLSX -------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => {
    if (code[0] !== '#') return ENTITIES[code] ?? match;
    return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  });

/** All text inside the <t> elements of a fragment, ignoring phonetic guides. */
function textOf(xml) {
  const visible = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let text = '';
  for (const m of visible.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeXml(m[1] ?? '');
  return text;
}

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

function columnIndex(reference) {
  let index = 0;
  for (const ch of reference) {
    if (ch < 'A' || ch > 'Z') break;
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

const readText = async (files, name) => files.has(name) && utf8.decode(await files.get(name)());

/** Path of the first worksheet, in the order the workbook lists its sheets. */
async function firstSheetPath(files) {
  const workbook = await readText(files, 'xl/workbook.xml');
  const rels = await readText(files, 'xl/_rels/workbook.xml.rels');
  const id = workbook && attribute(/<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '', 'r:id');
  if (id && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attribute(m[0], 'Id') !== id) continue;
      const target = attribute(m[0], 'Target');
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (files.has(path)) return path;
    }
  }
  return [...files.keys()].filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).sort()[0];
}

// ---- XLSX images ------------------------------------------------------------
// A picture is either placed over the sheet, anchored to the cell under its top-left corner,
// or (in recent Excel) placed in a cell as its value. Both are found through relationship
// files, which name the parts each part refers to.

/** The path of the part `target` names, from the part `from` that names it. */
function partPath(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** Map of relationship id to part path, for the part at `path`. */
async function relationships(files, path) {
  const slash = path.lastIndexOf('/');
  const xml = await readText(files, `${path.slice(0, slash)}/_rels/${path.slice(slash + 1)}.rels`);
  const rels = new Map();
  for (const m of (xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    if (attribute(m[0], 'TargetMode') === 'External') continue;
    rels.set(attribute(m[0], 'Id'), partPath(path, attribute(m[0], 'Target') ?? ''));
  }
  return rels;
}

const tag = (name) => `(?:\\w+:)?${name}`;

/** Pictures placed over the sheet: `[{ row, column, path }]`, counted from 0. */
async function anchoredImages(files, sheetPath, sheet) {
  const sheetRels = await relationships(files, sheetPath);
  const images = [];
  for (const drawing of sheet.matchAll(new RegExp(`<${tag('drawing')}\\b[^>]*>`, 'g'))) {
    const drawingPath = sheetRels.get(attribute(drawing[0], 'r:id'));
    const xml = drawingPath && (await readText(files, drawingPath));
    if (!xml) continue;
    const drawingRels = await relationships(files, drawingPath);
    const anchors = new RegExp(`<(${tag('(?:twoCellAnchor|oneCellAnchor)')})\\b[\\s\\S]*?<\\/\\1>`, 'g');
    for (const anchor of xml.matchAll(anchors)) {
      const from = new RegExp(`<${tag('from')}>([\\s\\S]*?)<\\/${tag('from')}>`).exec(anchor[0])?.[1] ?? '';
      const number = (name) => Number(new RegExp(`<${tag(name)}>(\\d+)<`).exec(from)?.[1]);
      const blip = new RegExp(`<${tag('blip')}\\b[^>]*>`).exec(anchor[0])?.[0];
      const path = blip && drawingRels.get(attribute(blip, 'r:embed'));
      if (path && files.has(path) && Number.isInteger(number('row'))) images.push({ row: number('row'), column: number('col') || 0, path });
    }
  }
  return images;
}

/** For pictures placed in cells: a function from a cell's `vm` number to the picture's path. */
async function inCellImages(files) {
  const metadata = await readText(files, 'xl/metadata.xml');
  const values = await readText(files, 'xl/richData/rdrichvalue.xml');
  if (!metadata || !values) return () => undefined;
  const blocks = (xml) => [...(xml ?? '').matchAll(/<bk\b[^>]*>([\s\S]*?)<\/bk>/g)].map((m) => m[1]);
  // A cell's vm picks a value block, which points into the rich value blocks of the future
  // metadata, each naming a rich value.
  const valueBlocks = blocks(/<valueMetadata\b[\s\S]*?<\/valueMetadata>/.exec(metadata)?.[0]);
  const richBlocks = blocks(/<futureMetadata\b[^>]*name="XLRICHVALUE"[\s\S]*?<\/futureMetadata>/.exec(metadata)?.[0]);
  const structures = [...((await readText(files, 'xl/richData/rdrichvaluestructure.xml')) || '').matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map((m) =>
    [...m[1].matchAll(/<k\b[^>]*>/g)].map((k) => attribute(k[0], 'n')),
  );
  const richValues = [...values.matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map((m) => ({
    structure: Number(attribute(m[1], 's') ?? 0),
    values: [...m[2].matchAll(/<v\b[^>]*>([\s\S]*?)<\/v>/g)].map((v) => v[1]),
  }));
  const relsPath = 'xl/richData/richValueRel.xml';
  const relIds = [...((await readText(files, relsPath)) || '').matchAll(/<rel\b[^>]*>/g)].map((m) => attribute(m[0], 'r:id'));
  const rels = await relationships(files, relsPath);
  return (vm) => {
    const rc = /<rc\b[^>]*>/.exec(valueBlocks[vm - 1] ?? '')?.[0];
    const rvb = rc && /<(?:\w+:)?rvb\b[^>]*>/.exec(richBlocks[Number(attribute(rc, 'v'))] ?? '')?.[0];
    const value = rvb && richValues[Number(attribute(rvb, 'i'))];
    if (!value) return undefined;
    const key = (structures[value.structure] ?? []).indexOf('_rvRel:LocalImageIdentifier');
    const path = rels.get(relIds[Number(value.values[Math.max(key, 0)])]);
    return path && files.has(path) ? path : undefined;
  };
}

/**
 * Rows of cell text from an .xlsx file. A picture in or over a cell joins that cell's text as
 * an [image:<path>] token, and its bytes are put in `images` under the same path.
 */
export async function parseXlsx(buffer, images = new Map()) {
  const files = readZip(buffer);
  const sheetPath = await firstSheetPath(files);
  if (!sheetPath) throw new Error('No worksheet found in this file.');

  const sharedXml = (await readText(files, 'xl/sharedStrings.xml')) || '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
  const cellImage = await inCellImages(files);
  const addImage = async (path) => {
    images.set(path, await files.get(path)());
    return `[image:${path}]`;
  };

  const sheet = await readText(files, sheetPath);
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    let next = 0;
    for (const cell of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, attrs, body = ''] = cell;
      const reference = attribute(attrs, 'r');
      const column = reference ? columnIndex(reference) : next;
      next = column + 1;
      const type = attribute(attrs, 't');
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const picture = attribute(attrs, 'vm') && cellImage(Number(attribute(attrs, 'vm')));
      let text = '';
      if (picture) text = await addImage(picture);
      else if (type === 'inlineStr') text = textOf(body);
      else if (value === undefined) text = '';
      else if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'b') text = value === '1' ? 'TRUE' : 'FALSE';
      else text = decodeXml(value);
      row[column] = text;
    }
    // Rows are numbered from 1; a row left out of the file is empty.
    const number = Number(attribute(rowMatch[1], 'r'));
    rows[Number.isInteger(number) && number > 0 ? number - 1 : rows.length] = row;
  }
  for (const { row, column, path } of await anchoredImages(files, sheetPath, sheet)) {
    const cells = (rows[row] ??= []);
    cells[column] = [cells[column], await addImage(path)].filter(Boolean).join('\n');
  }
  return Array.from(rows, (row) => Array.from(row ?? [], (cell) => cell ?? ''));
}

// ---- CSV and tab-separated text ---------------------------------------------

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Excel on Windows often saves CSV in this older encoding.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') cell += text[++i];
      else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---- Entry points -----------------------------------------------------------

/**
 * Rows of trimmed cell text from a spreadsheet file, without blank rows. Pictures in an .xlsx
 * file become [image:<path>] tokens, with their bytes put in `images` (see `parseXlsx`).
 */
export async function parseSpreadsheet(buffer, fileName = '', images = new Map()) {
  const bytes = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOldExcel = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOldExcel || (/\.xls$/i.test(fileName) && !isZip)) {
    throw new Error('Old .xls files are not supported. In Excel, use "Save As" and choose .xlsx.');
  }
  const rows = isZip ? await parseXlsx(buffer, images) : parseDelimited(decodeText(buffer));
  return rows
    .map((row) => row.map((cell) => String(cell).trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}
