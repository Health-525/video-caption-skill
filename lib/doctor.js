'use strict';

const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

function hasCommand(command, args = ['--version']) {
  try {
    if (process.platform === 'win32') {
      const quoted = [command, ...args].map(v => /[ \t"]/g.test(String(v)) ? `"${String(v).replace(/"/g, '\\"')}"` : String(v)).join(' ');
      execSync(quoted, { stdio: 'pipe' });
    } else {
      execFileSync(command, args, { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

function resolveYtDlp(preferredPython) {
  const pythonCandidates = [preferredPython, 'python', 'python3', 'py', 'D:\\Anaconda\\python.exe'].filter(Boolean);
  for (const python of pythonCandidates) {
    if (!python) continue;
    if (hasCommand(python, ['-m', 'yt_dlp', '--version'])) return `${python} -m yt_dlp`;
  }
  const candidates = [
    process.env.VIDEO_CAPTION_YTDLP,
    'yt-dlp',
    'yt-dlp.exe',
    'D:\\Anaconda\\Scripts\\yt-dlp.exe',
    'D:\\A\\timetable\\.venv\\Scripts\\yt-dlp.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (hasCommand(candidate)) return candidate;
  }
  return null;
}

function checkPythonModule(python, moduleName) {
  return hasCommand(python, ['-c', `import ${moduleName}`]);
}

async function runDoctor({ cookiesPath, python } = {}) {
  const nodeOk = true;
  const ytdlpBin = resolveYtDlp(python);
  const ytdlpOk = !!ytdlpBin;
  const pythonBin = python || (hasCommand('python') ? 'python' : hasCommand('python3') ? 'python3' : null);
  const pythonOk = !!pythonBin;
  const whisperOk = pythonOk ? checkPythonModule(pythonBin, 'faster_whisper') : false;
  const ffmpegOk = hasCommand('ffmpeg', ['-version']);
  const ffprobeOk = hasCommand('ffprobe', ['-version']);
  const cookiesOk = !!(cookiesPath && fs.existsSync(cookiesPath));

  console.log('video-caption doctor');
  console.log(`- node: ok`);
  console.log(`- yt-dlp: ${ytdlpOk ? `ok (${ytdlpBin})` : 'missing'}`);
  console.log(`- python: ${pythonOk ? `ok (${pythonBin})` : 'missing'}`);
  console.log(`- faster-whisper: ${whisperOk ? 'ok' : 'missing'}`);
  console.log(`- ffmpeg: ${ffmpegOk ? 'ok' : 'missing'}`);
  console.log(`- ffprobe: ${ffprobeOk ? 'ok' : 'missing'}`);
  console.log(`- cookies: ${cookiesOk ? `ok (${cookiesPath})` : `missing (${cookiesPath || 'youtube_cookies.txt'})`}`);

  if (!ytdlpOk) console.log('  fix: pip install -U yt-dlp');
  if (!pythonOk) console.log('  fix: install Python 3 or pass --python /path/to/python');
  if (pythonOk && !whisperOk) console.log(`  fix: ${pythonBin} -m pip install faster-whisper`);
  if (!ffmpegOk || !ffprobeOk) console.log('  fix: install ffmpeg (must include ffmpeg and ffprobe in PATH)');
  if (!cookiesOk) console.log('  note: subtitles may still work without cookies, but YouTube rate limits are more likely');

  return ytdlpOk ? 0 : 1;
}

module.exports = { runDoctor };
