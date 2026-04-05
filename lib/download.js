'use strict';

const { execFileSync, execFile, execSync, exec } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// For no-cookie environments, prefer lighter YouTube clients and skip
// unnecessary webpage/config/js fetches to reduce request count and rate-limit risk.
const NO_COOKIE_SAFE_ARGS = [
  '--extractor-args',
  'youtube:player_client=tv,mweb;player_skip=webpage,configs,js',
];

function quoteArg(arg) {
  const text = String(arg);
  if (!/[ \t"]/g.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function canRun(command, args = ['--version']) {
  try {
    if (process.platform === 'win32') {
      execSync([command, ...args].map(quoteArg).join(' '), { stdio: 'pipe' });
    } else {
      execFileSync(command, args, { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

function execCommand(command, args, callback) {
  if (process.platform === 'win32') {
    exec([command, ...args].map(quoteArg).join(' '), { encoding: 'utf8' }, callback);
    return;
  }
  execFile(command, args, { encoding: 'utf8' }, callback);
}

// ─── Resolve yt-dlp binary ───────────────────────────────────────────────────
function resolvePython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'py', 'D:\\Anaconda\\python.exe']
    : ['python3', 'python'];
  for (const candidate of candidates) {
    if (canRun(candidate, ['--version'])) return candidate;
  }
  return null;
}

function ytdlp() {
  const python = resolvePython();
  if (python) {
    if (canRun(python, ['-m', 'yt_dlp', '--version'])) {
      return { command: python, prefixArgs: ['-m', 'yt_dlp'] };
    }
  }

  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp', 'D:\\Anaconda\\Scripts\\yt-dlp.exe', 'D:\\A\\timetable\\.venv\\Scripts\\yt-dlp.exe']
    : ['yt-dlp'];
  for (const candidate of candidates) {
    if (canRun(candidate, ['--version'])) {
      return { command: candidate, prefixArgs: [] };
    }
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

function isRateLimited(stderr, stdout) {
  const text = (stderr + '\n' + (stdout || '')).toLowerCase();
  return text.includes('429') || text.includes('too many requests');
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
    const args1 = [...bin.prefixArgs, ...buildArgs(baseArgs(cookiesFile))];
    execCommand(bin.command, args1, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr });

      if (!cookiesFile && isRateLimited(stderr, stdout)) {
        console.warn('      [retry] rate limit detected without cookies, retrying with low-request YouTube client...');
        const argsSafe = [...bin.prefixArgs, ...buildArgs([...baseArgs(cookiesFile), ...NO_COOKIE_SAFE_ARGS])];
        return execCommand(bin.command, argsSafe, (errSafe, stdoutSafe, stderrSafe) => {
          if (!errSafe) return resolve({ stdout: stdoutSafe, stderr: stderrSafe });

          if (isNChallenge(stderrSafe, stdoutSafe)) {
            console.warn('      [retry] n challenge detected after low-request retry, retrying with EJS bypass...');
            const argsSafeEjs = [...bin.prefixArgs, ...buildArgs([...baseArgs(cookiesFile), ...NO_COOKIE_SAFE_ARGS, ...EJS_ARGS])];
            return execCommand(bin.command, argsSafeEjs, (errSafeEjs, stdoutSafeEjs, stderrSafeEjs) => {
              if (!errSafeEjs) return resolve({ stdout: stdoutSafeEjs, stderr: stderrSafeEjs });
              reject(classifyError(stderrSafeEjs, stdoutSafeEjs));
            });
          }

          reject(classifyError(stderrSafe, stdoutSafe));
        });
      }

      if (isNChallenge(stderr, stdout)) {
        // one retry with EJS bypass args
        console.warn('      [retry] n challenge detected, retrying with EJS bypass...');
        const args2 = [...bin.prefixArgs, ...buildArgs([...baseArgs(cookiesFile), ...EJS_ARGS])];
        execCommand(bin.command, args2, (err2, stdout2, stderr2) => {
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
    '--dump-single-json',
    '--no-playlist',
    url,
  ], cookiesFile);

  const data = JSON.parse(stdout.trim());
  const id = data.id;
  const title = data.title;
  const channel = data.uploader || data.channel || '';
  const uploadDate = data.upload_date || '';
  const webpage_url = data.webpage_url || url;
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

// ─── Download audio for Whisper ─────────────────────────────────────────────
// We intentionally avoid ffmpeg-based post-processing here so the fallback
// path works on more machines out of the box. faster-whisper (via PyAV)
// can usually read common downloaded audio containers directly.
async function getAudio(url, cookiesFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));

  await runWithRetry(base => [
    ...base,
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--output', path.join(tmpDir, '%(id)s.%(ext)s'),
    url,
  ], cookiesFile);

  const audioExts = new Set(['.mp3', '.m4a', '.webm', '.opus', '.wav', '.mp4', '.ogg']);
  const files = fs.readdirSync(tmpDir).filter(f => audioExts.has(path.extname(f).toLowerCase()));
  if (!files.length) throw new Error('No audio file downloaded');
  return path.join(tmpDir, files[0]);
}

module.exports = { download: { getMeta, getAudio, getSub }, listSubs };
