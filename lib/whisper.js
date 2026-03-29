'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── Whisper fallback via faster-whisper (Python) ────────────────────────────
// Requires: pip install faster-whisper
//
// python option: explicit interpreter path, e.g. /home/user/.venv/bin/python
//   avoids "wrong venv" problems on machines with multiple Python installs.
async function transcribe(audioFile, { model = 'base', lang = null, python = null } = {}) {
  return runFasterWhisperPython(audioFile, { model, lang, python });
}

function resolvePython(explicit) {
  if (explicit) return explicit;
  // common candidates in priority order
  const candidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3', 'python'];
  const { execFileSync } = require('child_process');
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'pipe' }); return c; } catch {}
  }
  throw new Error('Python not found. Install Python 3 or pass --python /path/to/python');
}

function runFasterWhisperPython(audioFile, { model, lang, python }) {
  const py = resolvePython(python);

  const langLine = lang ? `, language="${lang}"` : '';
  const script = [
    'import sys',
    'from faster_whisper import WhisperModel',
    `m = WhisperModel("${model}", device="cpu", compute_type="int8")`,
    `segs, info = m.transcribe(sys.argv[1], beam_size=5, vad_filter=False${langLine})`,
    'for s in segs:',
    '    sys.stdout.write(s.text + "\\n")',
    '    sys.stdout.flush()',
  ].join('\n');

  // write temp script next to audio file to avoid path quoting issues
  const tmpScript = path.join(os.tmpdir(), `vcap_whisper_${Date.now()}.py`);
  fs.writeFileSync(tmpScript, script, 'utf8');

  return new Promise((resolve, reject) => {
    execFile(py, [tmpScript, audioFile], { encoding: 'utf8', timeout: 600_000 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpScript); } catch {}

        if (err) {
          // Windows ctranslate2 segfault
          if (
            err.code === 0xC0000005 ||
            (stderr && stderr.toLowerCase().includes('segfault')) ||
            (stderr && stderr.includes('0xC0000005'))
          ) {
            return reject(new Error(
              'faster-whisper crashed (ctranslate2 Segfault 0xC0000005).\n' +
              'This is a known Windows/ctranslate2 incompatibility.\n' +
              'Options:\n' +
              '  1. Try pip install ctranslate2==3.24.0 (known stable version)\n' +
              '  2. Use WSL2 instead of native Windows Python\n' +
              '  3. Find a video with native subtitles (no Whisper needed)'
            ));
          }
          // missing faster-whisper
          if (stderr && stderr.includes('ModuleNotFoundError')) {
            return reject(new Error(
              'faster-whisper not installed.\n' +
              `Fix: ${py} -m pip install faster-whisper`
            ));
          }
          return reject(new Error(stderr.trim() || err.message));
        }
        resolve(stdout.trim());
      }
    );
  });
}

module.exports = { transcribe };
