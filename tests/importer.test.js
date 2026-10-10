import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDelimited, parseSpreadsheet } from '../js/importer.js';

function read(name) {
  const file = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return parseSpreadsheet(buffer, name);
}

test('reads an Excel file: accents, symbols, numbers, line breaks and rich text', async () => {
  const rows = await read('words.xlsx');
  assert.deepEqual(rows[0], ['Português', 'English', 'Notes']);
  assert.deepEqual(rows[1], ['o comboio', 'the train', 'PT-PT (BR: trem)']);
  assert.deepEqual(rows[3], ['pão & manteiga', 'bread & butter', '<common>']);
  assert.deepEqual(rows[5], ['quinze', '15']);
  assert.deepEqual(rows[6], ['Bom dia!\nComo está?', 'Good morning!\nHow are you?']);
  assert.deepEqual(rows[8], ['o pequeno-almoço', 'breakfast']);
});

test('trims cells, drops blank rows and keeps gaps between columns', async () => {
  const rows = await read('words.xlsx');
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[9], ['a rua', 'the street']);
  assert.deepEqual(rows[10], ['', '', '', 'stray cell']);
});

test('reads only the first sheet', async () => {
  const rows = await read('words.xlsx');
  assert.ok(!rows.flat().includes('should'));
});

test('reads an Excel file saved by LibreOffice', async () => {
  assert.deepEqual(await read('words-libreoffice.xlsx'), [
    ['o comboio', 'the train'],
    ['a estação', 'the station'],
    ['pão, queijo & vinho', 'bread, cheese & wine'],
  ]);
});

test('reads semicolon CSV in the Windows encoding, with quoted cells', async () => {
  assert.deepEqual(await read('words-semicolon.csv'), [
    ['Português', 'English'],
    ['o comboio', 'the train'],
    ['a estação; central', 'the "main" station'],
    ['pão', 'bread'],
  ]);
});

test('reads tab-separated text with a byte order mark', async () => {
  assert.deepEqual(await read('words.tsv'), [
    ['o comboio', 'the train'],
    ['a estação', 'the station'],
  ]);
});

test('CSV: commas, quoted line breaks and no trailing newline', () => {
  assert.deepEqual(parseDelimited('a,"b\nc",d\n"e, f",g,h'), [
    ['a', 'b\nc', 'd'],
    ['e, f', 'g', 'h'],
  ]);
});

test('rejects old .xls files and broken .xlsx files with a clear message', async () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer;
  await assert.rejects(parseSpreadsheet(xls, 'old.xls'), /Save As/);
  const broken = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]).buffer;
  await assert.rejects(parseSpreadsheet(broken, 'broken.xlsx'), /not a valid/);
});
