'use strict';

const { execFileSync, execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Resolve yt-dlp binary ───────────────────────────────────────────────────
function ytdlp() {
  // prefer local venv / PATH
  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : ['yt-dlp'];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'pipe' }); return c; } catch {}
  }
  throw new Error('yt-dlp not found. Install with: pip install yt-dlp');
}

// ─── Build common args ───────────────────────────────────────────────────────
function baseArgs(cookiesFile) {
  const args = ['--no-warnings'];
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
    // do NOT log the cookies path to avoid leaking info
  }
  return args;
}

// ─── Get video metadata (title, channel, upload date, id) ───────────────────
async function getMeta(url, cookiesFile) {
  const bin  = ytdlp();
  const args = [
    ...baseArgs(cookiesFile),
    '--print', '%(id)s\n%(title)s\n%(uploader)s\n%(upload_date)s\n%(webpage_url)s',
    '--no-playlist',
    url,
  ];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      const [id, title, channel, uploadDate, webpage_url] = stdout.trim().split('\n');
      resolve({
        id,
        title:      title      || 'Untitled',
        channel:    channel    || '',
        uploadDate: uploadDate ? `${uploadDate.slice(0,4)}-${uploadDate.slice(4,6)}-${uploadDate.slice(6,8)}` : '',
        url:        webpage_url || url,
      });
    });
  });
}

// ─── List available subtitle language codes ──────────────────────────────────
async function listSubs(url, cookiesFile) {
  const bin  = ytdlp();
  const args = [
    ...baseArgs(cookiesFile),
    '--list-subs',
    '--no-playlist',
    url,
  ];

  return new Promise((resolve) => {
    execFile(bin, args, { encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve([]);
      // parse language codes from --list-subs output
      // lines look like: "zh-Hans          vtt, ttml, srv3, srv2, srv1, json3"
      const langs = [];
      for (const line of stdout.split('\n')) {
        const m = line.match(/^([a-z]{2}(?:-[A-Za-z]+)*)\s+/);
        if (m) langs.push(m[1]);
      }
      resolve([...new Set(langs)]);
    });
  });
}

// ─── Download subtitle (VTT) ─────────────────────────────────────────────────
async function getSub(url, lang, cookiesFile) {
  const bin   = ytdlp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));
  const args  = [
    ...baseArgs(cookiesFile),
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', lang,
    '--sub-format', 'vtt',
    '--no-playlist',
    '--output', path.join(tmpDir, '%(id)s'),
    url,
  ];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      // find the downloaded vtt file
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
      if (!files.length) return reject(new Error('No VTT file downloaded'));
      resolve(path.join(tmpDir, files[0]));
    });
  });
}

// ─── Download audio (mp3) for Whisper ───────────────────────────────────────
async function getAudio(url, cookiesFile) {
  const bin    = ytdlp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));
  const args   = [
    ...baseArgs(cookiesFile),
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--no-playlist',
    '--output', path.join(tmpDir, '%(id)s.%(ext)s'),
    url,
  ];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.mp3'));
      if (!files.length) return reject(new Error('No audio file downloaded'));
      resolve(path.join(tmpDir, files[0]));
    });
  });
}

module.exports = { download: { getMeta, getAudio }, listSubs, getSub: getSub };
// also export getSub directly for bin/
module.exports.download.getSub = getSub;
