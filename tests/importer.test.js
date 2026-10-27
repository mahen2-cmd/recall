import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDelimited, parseSpreadsheet } from '../js/importer.js';
import { PNG, arrayBuffer, zip } from './zip.js';

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

const rels = (...targets) =>
  `<Relationships>${targets.map((target, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="${target}"/>`).join('')}</Relationships>`;

test('reads pictures placed in a cell and pictures placed over the sheet', async () => {
  const GIF = Buffer.from('GIF89a-picture');
  const file = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Robot" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': rels('worksheets/sheet1.xml'),
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Joint</t></is></c><c r="B1" t="e" vm="1"><v>#VALUE!</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Link</t></is></c><c r="B3" t="inlineStr"><is><t>See:</t></is></c></row>' +
      '</sheetData><drawing r:id="rId1"/></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': rels('../drawings/drawing1.xml'),
    'xl/drawings/drawing1.xml':
      '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>4</xdr:col><xdr:row>9</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels': rels('../media/image2.gif'),
    'xl/metadata.xml':
      '<metadata><futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata>' +
      '<valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>',
    'xl/richData/rdrichvalue.xml': '<rvData><rv s="0"><v>5</v><v>0</v></rv></rvData>',
    'xl/richData/rdrichvaluestructure.xml': '<rvStructures><s t="_localImage"><k n="CalcOrigin" t="i"/><k n="_rvRel:LocalImageIdentifier" t="i"/></s></rvStructures>',
    'xl/richData/richValueRel.xml': '<richValueRels><rel r:id="rId1"/></richValueRels>',
    'xl/richData/_rels/richValueRel.xml.rels': rels('../media/image1.png'),
    'xl/media/image1.png': PNG,
    'xl/media/image2.gif': GIF,
  });
  const images = new Map();
  assert.deepEqual(await parseSpreadsheet(arrayBuffer(file), 'robot.xlsx', images), [
    ['Joint', '[image:xl/media/image1.png]'],
    ['Link', 'See:\n[image:xl/media/image2.gif]'],
  ]);
  assert.deepEqual([...images.keys()], ['xl/media/image1.png', 'xl/media/image2.gif']);
  assert.deepEqual(Buffer.from(images.get('xl/media/image1.png')), PNG);
  assert.deepEqual(Buffer.from(images.get('xl/media/image2.gif')), GIF);
});
