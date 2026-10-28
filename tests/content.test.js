import test from 'node:test';
import assert from 'node:assert/strict';

import { hasRichContent, imageNames, imageType, mathSpans, mathToken, parseContent, speechText } from '../js/content.js';
import { mathSpeech } from '../js/mathspeech.js';
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

test('finds where each piece of maths sits, to edit it in place', () => {
  const text = 'v = \\( \\omega r \\) [image:a.png]\n\\[x\\]';
  assert.deepEqual(mathSpans(text), [
    { start: 4, end: 18, math: '\\omega r', display: false },
    { start: 33, end: 38, math: 'x', display: true },
  ]);
  assert.equal(text.slice(4, 18), '\\( \\omega r \\)');
  assert.equal(mathToken('x^2', false), '\\( x^2 \\)');
  assert.equal(mathToken('x^2', true), '\\[ x^2 \\]');
});

test('reads maths aloud as words, and leaves out images', () => {
  assert.equal(
    speechText('The Jacobian \\( J(q) \\) maps\n\\[ \\dot x = J \\dot q \\] velocities [image:a.png]'),
    'The Jacobian J of q maps x dot equals J q dot velocities',
  );
  assert.equal(speechText('\\( x^2 \\) [image:a.png]'), 'x squared');
  assert.equal(speechText('[image:a.png]'), '');
});

test('reads maths the way it is said', () => {
  const cases = [
    ['x^2 + y^2 = 1', 'x squared plus y squared equals 1'],
    ['\\mathbb{R}^3 \\times S^1 = T^2', 'R 3 cross S 1 equals T 2'],
    ['A(q) \\in \\mathbb{R}^{2 \\times 4}', 'A of q, in R 2 by 4'],
    ['2 \\times 3 = 6', '2 times 3 equals 6'],
    ['3(4-1-4) + 4 = 1', '3 times, 4 minus 1 minus 4, plus 4 equals 1'],
    ['\\dot\\theta_1 = \\frac{r}{2d}(\\omega_1 - \\omega_2)', 'theta 1 dot equals r over 2 d times, omega 1 minus omega 2'],
    ['\\frac{\\partial g}{\\partial q}\\dot q = 0', 'partial g by partial q q dot equals 0'],
    ['\\frac{n(n+1)}{2}', 'the fraction n times, n plus 1, over 2, end fraction'],
    ['\\sqrt{x^2 + y^2} \\le 3', 'the square root of x squared plus y squared, is less than or equal to 3'],
    ['\\sum_{i=1}^{J} f_i', 'the sum from i equals 1 to J of f i'],
    ['\\phi = \\tan^{-1}(\\beta/\\alpha)', 'phi equals inverse tangent of beta over alpha'],
    ['q = [x\\; y]^T', 'q equals x y, transpose'],
    ['\\|A - B\\|^2 = h^2', 'the norm of A minus B, squared equals h squared'],
    ['\\text{dof} = 6(N-1-J) + \\sum f_i', 'dof equals 6 times, N minus 1 minus J, plus the sum of f i'],
    ['\\begin{bmatrix} \\dot x \\\\ \\dot y \\end{bmatrix}', 'the column vector x dot, y dot, end vector'],
    ['\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}', 'the matrix with rows 1, 0; next row 0, 1, end matrix'],
    ['\\theta \\in [-90°, 90°]', 'theta in minus 90 degrees, 90 degrees'],
  ];
  for (const [latex, words] of cases) assert.equal(mathSpeech(latex), words, latex);
});

test('recognises image files by their first bytes', () => {
  assert.equal(imageType(PNG), 'png');
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageType(Buffer.from('GIF89a')), 'gif');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(imageType(Buffer.from('%PDF-1.7')), null);
});
