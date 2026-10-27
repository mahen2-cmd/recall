import test from 'node:test';
import assert from 'node:assert/strict';

import { hasRichContent, imageNames, imageType, parseContent, speechText } from '../js/content.js';
import { PNG } from './zip.js';

test('splits a side into text, maths and images', () => {
  assert.deepEqual(parseContent('Angle \\( \\theta \\) is\n\\[ R = \\begin{bmatrix} 1 \\end{bmatrix} \\][image:ab.png] done'), [
    { text: 'Angle ' },
    { math: '\\theta', display: false },
    { text: ' is\n' },
    { math: 'R = \\begin{bmatrix} 1 \\end{bmatrix}', display: true },
    { image: 'ab.png' },
    { text: ' done' },
  ]);
  assert.deepEqual(parseContent('plain $5 (not maths)'), [{ text: 'plain $5 (not maths)' }]);
  assert.deepEqual(parseContent(''), []);
  assert.equal(hasRichContent('a \\(x\\)'), true);
  assert.equal(hasRichContent('a [b] (c)'), false);
  assert.deepEqual(imageNames('[image:a.png] x [image:b.gif]'), ['a.png', 'b.gif']);
});

test('reads aloud only the words, without maths or images', () => {
  assert.equal(speechText('The Jacobian \\( J(q) \\) maps\n\\[ \\dot x = J \\dot q \\] velocities [image:a.png]'), 'The Jacobian maps velocities');
  assert.equal(speechText('\\( x^2 \\) [image:a.png]'), '');
});

test('recognises image files by their first bytes', () => {
  assert.equal(imageType(PNG), 'png');
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageType(Buffer.from('GIF89a')), 'gif');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(imageType(Buffer.from('%PDF-1.7')), null);
});
