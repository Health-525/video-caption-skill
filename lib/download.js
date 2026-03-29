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

// ─── Classify yt-dlp stderr into actionable errors ──────────────────────────
function classifyError(stderr, stdout) {
  const text = (stderr + '\n' + (stdout || '')).toLowerCase();

  if (text.includes('n challenge') || text.includes('nsig')) {
    return new Error(
      'yt-dlp failed to solve YouTube\'s "n challenge" (anti-bot JS).\n' +
      'Fix options (try in order):\n' +
      '  1. pip install -U yt-dlp          (most common fix)\n' +
      '  2. yt-dlp --update\n' +
      '  3. Add --extractor-args youtube:player_client=web to yt-dlp calls\n' +
      '  4. Use a different network / VPN exit node\n' +
      '  5. Ensure youtube_cookies.txt is fresh (re-export from browser)'
    );
  }
  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return new Error(
      'YouTube is requesting bot verification.\n' +
      'Fix: re-export youtube_cookies.txt from a logged-in browser session.'
    );
  }
  if (text.includes('only images are available') || text.includes('requested format is not available')) {
    return new Error(
      'yt-dlp can only see storyboard images for this video — likely an n challenge failure.\n' +
      'Fix: pip install -U yt-dlp, then retry.'
    );
  }
  if (text.includes('429') || text.includes('too many requests')) {
    return new Error(
      'YouTube rate-limited this request (HTTP 429).\n' +
      'Fix: use youtube_cookies.txt from a logged-in session, or wait before retrying.'
    );
  }
  if (text.includes('video unavailable') || text.includes('private video')) {
    return new Error('Video is unavailable or private.');
  }
  return new Error(stderr.trim() || 'yt-dlp exited with an error');
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
      if (err) return reject(classifyError(stderr, stdout));
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
      if (err) return reject(classifyError(stderr, stdout));
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
      if (err) return reject(classifyError(stderr, stdout));
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.mp3'));
      if (!files.length) return reject(new Error('No audio file downloaded'));
      resolve(path.join(tmpDir, files[0]));
    });
  });
}

module.exports = { download: { getMeta, getAudio }, listSubs, getSub: getSub };
// also export getSub directly for bin/
module.exports.download.getSub = getSub;
