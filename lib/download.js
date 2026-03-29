'use strict';

const { execFileSync, execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Resolve yt-dlp binary ───────────────────────────────────────────────────
function ytdlp() {
  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : ['yt-dlp'];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'pipe' }); return c; } catch {}
  }
  throw new Error('yt-dlp not found. Install with: pip install yt-dlp');
}

// ─── EJS/n-challenge bypass args ────────────────────────────────────────────
// These are appended on auto-retry when the first attempt hits an n challenge.
const EJS_ARGS = [
  '--js-runtimes',     'node',
  '--remote-components', 'ejs:github',
  '--extractor-args',  'youtube:player_client=web',
];

function isNChallenge(stderr, stdout) {
  const text = (stderr + '\n' + (stdout || '')).toLowerCase();
  return (
    text.includes('n challenge') ||
    text.includes('nsig') ||
    text.includes('only images are available') ||
    text.includes('requested format is not available')
  );
}

// ─── Classify yt-dlp stderr into actionable errors ──────────────────────────
function classifyError(stderr, stdout) {
  const text = (stderr + '\n' + (stdout || '')).toLowerCase();

  if (text.includes('n challenge') || text.includes('nsig')) {
    return new Error(
      'yt-dlp failed to solve YouTube\'s "n challenge" (anti-bot JS).\n' +
      'Fix options (try in order):\n' +
      '  1. pip install -U yt-dlp\n' +
      '  2. yt-dlp --update\n' +
      '  3. Ensure youtube_cookies.txt is fresh (re-export from browser)\n' +
      '  4. Use a different network / VPN exit node'
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
      'yt-dlp can only see storyboard images — n challenge was not solved even with EJS retry.\n' +
      'Fix: pip install -U yt-dlp, refresh cookies, or try a different network.'
    );
  }
  if (text.includes('429') || text.includes('too many requests')) {
    return new Error(
      'YouTube rate-limited this request (HTTP 429).\n' +
      'Fix: use a fresh youtube_cookies.txt, or wait before retrying.'
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
  }
  return args;
}

// ─── Run yt-dlp with automatic EJS retry on n challenge ─────────────────────
// cb(bin, args) must return a Promise that resolves/rejects.
// On first failure that looks like an n challenge, we append EJS_ARGS and retry once.
function runWithRetry(buildArgs, cookiesFile) {
  const bin = ytdlp();

  return new Promise((resolve, reject) => {
    const args1 = buildArgs(baseArgs(cookiesFile));
    execFile(bin, args1, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr });

      if (isNChallenge(stderr, stdout)) {
        // one retry with EJS bypass args
        console.warn('      [retry] n challenge detected, retrying with EJS bypass...');
        const args2 = buildArgs([...baseArgs(cookiesFile), ...EJS_ARGS]);
        execFile(bin, args2, { encoding: 'utf8' }, (err2, stdout2, stderr2) => {
          if (!err2) return resolve({ stdout: stdout2, stderr: stderr2 });
          reject(classifyError(stderr2, stdout2));
        });
      } else {
        reject(classifyError(stderr, stdout));
      }
    });
  });
}

// ─── Get video metadata (title, channel, upload date, id) ───────────────────
async function getMeta(url, cookiesFile) {
  const { stdout } = await runWithRetry(base => [
    ...base,
    '--print', '%(id)s\n%(title)s\n%(uploader)s\n%(upload_date)s\n%(webpage_url)s',
    '--no-playlist',
    url,
  ], cookiesFile);

  const [id, title, channel, uploadDate, webpage_url] = stdout.trim().split('\n');
  return {
    id,
    title:      title      || 'Untitled',
    channel:    channel    || '',
    uploadDate: uploadDate
      ? `${uploadDate.slice(0,4)}-${uploadDate.slice(4,6)}-${uploadDate.slice(6,8)}`
      : '',
    url: webpage_url || url,
  };
}

// ─── List available subtitle language codes ──────────────────────────────────
async function listSubs(url, cookiesFile) {
  let stdout = '';
  try {
    ({ stdout } = await runWithRetry(base => [
      ...base,
      '--list-subs',
      '--no-playlist',
      url,
    ], cookiesFile));
  } catch {
    return [];
  }

  const langs = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^([a-z]{2}(?:-[A-Za-z]+)*)\s+/);
    if (m) langs.push(m[1]);
  }
  return [...new Set(langs)];
}

// ─── Download subtitle (VTT) ─────────────────────────────────────────────────
async function getSub(url, lang, cookiesFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));

  await runWithRetry(base => [
    ...base,
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', lang,
    '--sub-format', 'vtt',
    '--no-playlist',
    '--output', path.join(tmpDir, '%(id)s'),
    url,
  ], cookiesFile);

  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
  if (!files.length) throw new Error('No VTT file downloaded');
  return path.join(tmpDir, files[0]);
}

// ─── Download audio (mp3) for Whisper ───────────────────────────────────────
async function getAudio(url, cookiesFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));

  await runWithRetry(base => [
    ...base,
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--no-playlist',
    '--output', path.join(tmpDir, '%(id)s.%(ext)s'),
    url,
  ], cookiesFile);

  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.mp3'));
  if (!files.length) throw new Error('No audio file downloaded');
  return path.join(tmpDir, files[0]);
}

module.exports = { download: { getMeta, getAudio, getSub }, listSubs };
