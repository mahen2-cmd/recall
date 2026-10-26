// Text-to-speech for the local server. Engines, in order of preference:
//   - Azure neural voices, when data/tts.json holds a key (official)
//   - Google Translate's voice (no account, but unofficial: it can stop working if
//     Google changes or blocks the address)
//   - Microsoft Edge's read-aloud voices, through the edge-tts tool (also unofficial)
//   - Piper, a local offline voice, used when the others cannot be reached
// The last two are installed by `npm run setup-voice`. Setting "engine" in data/tts.json
// to "azure", "google", "edge" or "piper" moves that one to the front.
// Each side of a card has its own language. The "voice" in data/tts.json is used for its
// own language; other languages get a default voice. Piper only speaks Portuguese.
// Every sentence is generated once and then served from data/audio/.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_VOICE = 'pt-PT-RaquelNeural';
// Voices for Azure and Edge in the other languages a card side can be read in.
const VOICES = { 'en-US': 'en-US-JennyNeural', 'en-GB': 'en-GB-SoniaNeural' };
const PIPER_LANG = 'pt-PT';
const MAX_TEXT = 2000;
const TIMEOUT = 30_000;
const GOOGLE_CHUNK = 200; // most characters Google Translate reads in one request
const TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav' };

const exists = (file) => access(file).then(() => true, () => false);

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], timeout: TIMEOUT });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.trim().slice(-300)}`)),
    );
    child.stdin.end(input ?? '');
  });
}

/** Split text into pieces of at most `limit` characters, breaking at punctuation where possible. */
export function splitText(text, limit) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = -1;
    for (const breaks of [/[.!?;:…]\s/g, /,\s/g, /\s/g]) {
      for (const m of window.matchAll(breaks)) cut = m.index + 1;
      if (cut > 0) break;
    }
    if (cut <= 0) cut = limit; // one very long word
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function createTts({ root, dataDir }) {
  const configFile = join(dataDir, 'tts.json');
  const audioDir = join(dataDir, 'audio');
  const piperBin = join(root, '.tts', 'venv', 'bin', 'piper');
  const edgeBin = join(root, '.tts', 'venv', 'bin', 'edge-tts');
  const piperModel = join(root, '.tts', 'voices', 'pt_PT-medium.onnx');
  const inFlight = new Map();
  let piperQueue = Promise.resolve();
  let ffmpeg; // undefined until first checked

  // 'pt-PT-RaquelNeural' -> 'pt-PT'
  const langOf = (voice) => voice.split('-').slice(0, 2).join('-');

  async function config() {
    try {
      const c = JSON.parse(await readFile(configFile, 'utf8'));
      const key = String(c.azureKey ?? '').trim();
      const region = String(c.azureRegion ?? '').trim().toLowerCase().replace(/\s+/g, '');
      const voice = c.voice || DEFAULT_VOICE;
      return { azure: key && region ? { key, region } : null, voice, lang: langOf(voice), engine: c.engine };
    } catch {
      return { azure: null, voice: DEFAULT_VOICE, lang: langOf(DEFAULT_VOICE) };
    }
  }

  const hasPiper = async () => (await exists(piperBin)) && (await exists(piperModel));
  const hasEdge = () => exists(edgeBin);

  async function hasFfmpeg() {
    ffmpeg ??= await run('ffmpeg', ['-version']).then(() => true, () => false);
    return ffmpeg;
  }

  /** The engines that can speak `lang`, best first, as `{ id, name, make(text, base) }`. */
  async function engines(lang) {
    const cfg = await config();
    lang ??= cfg.lang;
    // Azure and Edge need a voice made for the language.
    const voice = lang === cfg.lang ? cfg.voice : VOICES[lang];
    const mp3 = (speak) => (text, base) => speak(text, `${base}.mp3`).then(() => `${base}.mp3`);
    const list = [];
    if (cfg.azure && voice) {
      list.push({ id: 'azure', name: `azure:${voice}`, make: mp3((text, file) => azureSpeak(text, { ...cfg, voice, lang }, file)) });
    }
    list.push({ id: 'google', name: `google:${lang}`, make: mp3((text, file) => googleSpeak(text, lang, file)) });
    if (voice && (await hasEdge())) {
      list.push({ id: 'edge', name: `edge:${voice}`, make: mp3((text, file) => edgeSpeak(text, voice, file)) });
    }
    if (lang === PIPER_LANG && (await hasPiper())) {
      // One at a time: each run loads the voice model.
      const queued = (text, base) =>
        (piperQueue = piperQueue.then(() => piperSpeak(text, base), () => piperSpeak(text, base)));
      list.push({ id: 'piper', name: 'piper:pt_PT', make: queued });
    }
    return list.sort((a, b) => (b.id === cfg.engine) - (a.id === cfg.engine));
  }

  /** Which engine will speak. */
  const engine = async () => (await engines())[0].name;

  async function azureSpeak(text, { azure, voice, lang }, target) {
    const res = await fetch(`https://${azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azure.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'recall-flashcards',
      },
      body: `<speak version='1.0' xml:lang='${lang}'><voice name='${escapeXml(voice)}'>${escapeXml(text)}</voice></speak>`,
    });
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? 'check azureKey and azureRegion in data/tts.json'
          : res.status === 429
            ? 'the free quota or rate limit was reached'
            : res.status === 400
              ? `check the voice name "${voice}"`
              : await res.text();
      const error = new Error(`Azure speech failed (${res.status}): ${hint}`);
      error.http = true;
      throw error;
    }
    await writeFile(`${target}.tmp`, Buffer.from(await res.arrayBuffer()));
    await rename(`${target}.tmp`, target);
  }

  async function googleSpeak(text, lang, target) {
    const parts = [];
    for (const chunk of splitText(text, GOOGLE_CHUNK)) {
      const query = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: lang, q: chunk });
      const res = await fetch(`https://translate.google.com/translate_tts?${query}`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok || !res.headers.get('content-type')?.startsWith('audio/')) {
        throw new Error(`Google Translate voice failed (${res.status})`);
      }
      parts.push(Buffer.from(await res.arrayBuffer()));
    }
    // MP3 is a stream of independent frames, so the pieces can simply be joined.
    await writeFile(`${target}.tmp`, Buffer.concat(parts));
    await rename(`${target}.tmp`, target);
  }

  async function edgeSpeak(text, voice, target) {
    await run(edgeBin, ['--voice', voice, `--text=${text}`, '--write-media', `${target}.tmp`]);
    await rename(`${target}.tmp`, target);
  }

  async function piperSpeak(text, base) {
    const wav = `${base}.wav`;
    await run(piperBin, ['-m', piperModel, '-f', `${wav}.tmp`], text);
    if (!(await hasFfmpeg())) {
      await rename(`${wav}.tmp`, wav);
      return wav;
    }
    // Compress, since raw audio is about ten times larger.
    const mp3 = `${base}.mp3`;
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'wav', '-i', `${wav}.tmp`, '-b:a', '64k', '-f', 'mp3', `${mp3}.tmp`]);
    await unlink(`${wav}.tmp`);
    await rename(`${mp3}.tmp`, mp3);
    return mp3;
  }

  async function cached(base) {
    for (const ext of ['mp3', 'wav']) if (await exists(`${base}.${ext}`)) return `${base}.${ext}`;
    return null;
  }

  async function generate(text, lang) {
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 32);
    // Use the best engine that works, so a failure or being offline still gives some audio.
    let failure;
    const list = await engines(lang);
    for (const { name, make } of list) {
      const base = join(audioDir, name.replace(/[^\w.-]/g, '_'), hash);
      const preferred = name === list[0].name;
      const hit = await cached(base);
      if (hit) return { file: hit, engine: name, preferred, fresh: false };
      await mkdir(join(base, '..'), { recursive: true });
      try {
        return { file: await make(text, base), engine: name, preferred, fresh: true };
      } catch (error) {
        if (error.http) throw error; // a problem with the Azure key or voice: report it
        failure = error;
      }
    }
    throw failure;
  }

  /**
   * Generate and cache the audio for `text` if it is not cached yet. Returns
   * `{ file, engine, preferred, fresh }`: the engine that made it, whether that is the first
   * choice rather than a fallback, and whether it was made just now.
   * `lang` is a language such as 'en-US'; without it the configured voice's language is used.
   */
  async function prepare(raw, lang) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) throw new Error('Nothing to say');
    if (lang && !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) throw new Error('Unknown language');
    const key = `${lang ?? ''}\n${text}`;
    if (!inFlight.has(key)) {
      inFlight.set(key, generate(text, lang || undefined).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  /** Audio for `text` as `{ body, type }`, generating and caching it if needed. */
  async function speak(raw, lang) {
    const { file } = await prepare(raw, lang);
    return { body: await readFile(file), type: TYPES[file.slice(-3)] };
  }

  return { engine, prepare, speak };
}
