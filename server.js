// Local server for Recall. Serves the app and saves all decks, cards and learning
// progress to a JSON file on disk (data/recall.json by default), and the images on cards
// to data/media/.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAnkiPackage } from './anki.js';
import { IMAGE_TYPES, MEDIA_NAME, imageType } from './js/content.js';
import { createTts } from './tts.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const DATA_DIR = resolve(process.env.RECALL_DATA || join(ROOT, 'data'));
const DATA_FILE = join(DATA_DIR, 'recall.json');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const MEDIA_DIR = join(DATA_DIR, 'media');
const BACKUPS_TO_KEEP = 30;
const MAX_BODY = 100 * 1024 * 1024;
// An Anki package carries its images, so it may be much larger.
const MAX_PACKAGE = 1024 * 1024 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;

const tts = createTts({ root: ROOT, dataDir: DATA_DIR });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const exists = (file) => access(file).then(() => true, () => false);

/** Before the first save of each day, keep a copy of the file as it was. */
async function backup() {
  if (!(await exists(DATA_FILE))) return;
  const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time
  const target = join(BACKUP_DIR, `recall-${today}.json`);
  if (await exists(target)) return;
  await mkdir(BACKUP_DIR, { recursive: true });
  await copyFile(DATA_FILE, target);
  const old = (await readdir(BACKUP_DIR)).filter((f) => /^recall-.*\.json$/.test(f)).sort();
  for (const f of old.slice(0, -BACKUPS_TO_KEEP)) await unlink(join(BACKUP_DIR, f));
}

async function saveState(json) {
  await mkdir(DATA_DIR, { recursive: true });
  await backup();
  // Write to a temporary file first so a crash can never leave a half-written file.
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, DATA_FILE);
}

// Saves run one at a time, in the order they arrive.
let queue = Promise.resolve();
const enqueue = (task) => (queue = queue.then(task, task));

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new Error('too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function speech(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const { body, type } = await tts.speak(params.get('text'), params.get('lang'), { save: params.get('save') !== '0' });
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
}

async function api(req, res) {
  const headers = { 'Cache-Control': 'no-store', 'X-Data-File': encodeURIComponent(DATA_FILE) };
  if (req.method === 'GET') {
    headers['X-Tts-Engine'] = encodeURIComponent(await tts.engine());
    await queue;
    const body = await readFile(DATA_FILE).catch(() => null);
    if (!body) return res.writeHead(204, headers).end();
    return res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(body);
  }
  if (req.method === 'PUT') {
    const body = (await readBody(req)).toString('utf8');
    const data = JSON.parse(body);
    if (!Array.isArray(data?.decks) || !Array.isArray(data?.cards)) throw new Error('invalid state');
    await enqueue(() => saveState(body));
    return res.writeHead(204, headers).end();
  }
  res.writeHead(405, headers).end();
}

/**
 * Keep an image in data/media/ and return its name. Images are named by their contents, so the
 * same one added twice is kept once.
 */
async function saveImage(bytes) {
  const type = imageType(bytes);
  if (!type) throw new Error('Only PNG, JPEG, GIF, WebP and SVG images can be added.');
  if (bytes.length > MAX_IMAGE) throw new Error('That image is larger than 20 MB.');
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${type}`;
  const file = join(MEDIA_DIR, name);
  if (!(await exists(file))) {
    await mkdir(MEDIA_DIR, { recursive: true });
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }
  return name;
}

async function upload(req, res) {
  const name = await saveImage(await readBody(req, MAX_IMAGE + 1));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ name }));
}

async function image(name, res) {
  const body = MEDIA_NAME.test(name) && (await readFile(join(MEDIA_DIR, name)).catch(() => null));
  if (!body) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  res.writeHead(200, {
    'Content-Type': IMAGE_TYPES[extname(name).slice(1)],
    // An image never changes under its name.
    'Cache-Control': 'private, max-age=31536000, immutable',
    // An SVG opened on its own must not run scripts with the app's access.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * Turn an uploaded Anki package into decks and cards. Only the images the cards show are
 * saved here; the cards are added by the app once they are confirmed.
 */
async function anki(req, res) {
  const decks = await readAnkiPackage(await readBody(req, MAX_PACKAGE), { saveImage });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(decks));
}

async function staticFile(path, res) {
  if (path === '/') path = '/index.html';
  // Only the app itself is served; the data folder is not reachable by URL.
  const allowed = path === '/index.html' || ['/js/', '/css/', '/vendor/'].some((dir) => path.startsWith(dir));
  const file = join(ROOT, normalize(path));
  if (!allowed || !file.startsWith(ROOT)) throw new Error('not found');
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

createServer(async (req, res) => {
  // Only answer requests addressed to this machine, so other sites cannot reach the data.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    return res.writeHead(403).end('Forbidden');
  }
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const isApi = path.startsWith('/api/');
  // Browsers say where a request comes from; refuse API calls made by other websites.
  const site = req.headers['sec-fetch-site'];
  if (isApi && site && site !== 'same-origin' && site !== 'none') {
    return res.writeHead(403).end('Forbidden');
  }
  try {
    if (path === '/api/state') await api(req, res);
    else if (path === '/api/tts' && req.method === 'GET') await speech(req, res);
    else if (path === '/api/anki' && req.method === 'POST') await anki(req, res);
    else if (path === '/api/media' && req.method === 'POST') await upload(req, res);
    else if (path.startsWith('/api/media/') && req.method === 'GET') await image(path.slice('/api/media/'.length), res);
    else await staticFile(path, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    const status = isApi ? 400 : 404;
    res.writeHead(status, { 'Content-Type': 'text/plain' }).end(status === 400 ? String(error.message) : 'Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Recall is running at http://localhost:${PORT}`);
  console.log(`Your decks and cards are saved in ${DATA_FILE}`);
  tts.engine().then((engine) => console.log(`Voice: ${engine}`));
});
