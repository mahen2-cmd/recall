// What a card side holds besides plain text: maths and images.
//   \( ... \)        maths within a line
//   \[ ... \]        maths on a line of its own
//   [image:<name>]   an image kept by the server in data/media/
// Used by the app to draw cards, and by the server and scripts to work out what to read aloud.

const TOKEN = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\[image:([^\]\s]+)\]/g;

/** A side's text split into parts: `{ text }`, `{ math, display }` and `{ image }`. */
export function parseContent(raw) {
  const text = String(raw ?? '');
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    if (m[3] !== undefined) parts.push({ image: m[3] });
    else parts.push({ math: (m[1] ?? m[2]).trim(), display: m[2] !== undefined });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Whether a side holds anything other than plain text. */
export const hasRichContent = (text) => parseContent(text).some((part) => part.text === undefined);

/** The words of a side to read aloud: the text without its maths and images. */
export function speechText(text) {
  return parseContent(text)
    .map((part) => part.text ?? ' ')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The names of the images a side shows. */
export const imageNames = (text) => parseContent(text).filter((part) => part.image).map((part) => part.image);

/** The token that shows a stored image on a card. */
export const imageToken = (name) => `[image:${name}]`;

// ---- Image files ------------------------------------------------------------

// Stored images are named by a hash of their bytes, so the same picture is only kept once.
export const MEDIA_NAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp|svg)$/;

export const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const startsWith = (bytes, signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** The file extension of an image from its first bytes, or null when it is not one Recall shows. */
export function imageType(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, ascii('GIF8'))) return 'gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  const head = new TextDecoder().decode(bytes.subarray(0, 1000)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'svg';
  return null;
}
