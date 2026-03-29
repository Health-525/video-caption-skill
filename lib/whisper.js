'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

// ─── Whisper fallback via faster-whisper CLI ─────────────────────────────────
// Requires: pip install faster-whisper
// Called only when no native subtitles found or --whisper flag used
async function transcribe(audioFile, { model = 'base', lang = null } = {}) {
  // Try faster-whisper CLI first, then Python fallback
  try {
    return await runFasterWhisperCli(audioFile, { model, lang });
  } catch {
    return await runFasterWhisperPython(audioFile, { model, lang });
  }
}

// faster-whisper as subprocess via inline Python script
function runFasterWhisperPython(audioFile, { model, lang }) {
  const langArg = lang ? `language="${lang}"` : '';
  const script = `
import sys
from faster_whisper import WhisperModel
m = WhisperModel("${model}", device="cpu", compute_type="int8")
segs, info = m.transcribe(sys.argv[1], beam_size=5, vad_filter=False${lang ? `, language="${lang}"` : ''})
for s in segs:
    print(s.text)
`;

  return new Promise((resolve, reject) => {
    // write temp script to avoid shell quoting issues
    const tmpScript = audioFile.replace(/\.\w+$/, '_whisper.py');
    fs.writeFileSync(tmpScript, script, 'utf8');

    const py = process.platform === 'win32' ? 'python' : 'python3';
    execFile(py, [tmpScript, audioFile], { encoding: 'utf8', timeout: 600_000 },
      (err, stdout, stderr) => {
        fs.unlinkSync(tmpScript);
        if (err) {
          if (err.code === 0xC0000005 || (stderr && stderr.includes('Segfault'))) {
            return reject(new Error(
              'faster-whisper crashed (ctranslate2 Segfault 0xC0000005). ' +
              'This is a known Windows compatibility issue. ' +
              'Try a video with native subtitles instead.'
            ));
          }
          return reject(new Error(stderr.trim() || err.message));
        }
        resolve(stdout.trim());
      }
    );
  });
}

// placeholder for faster-whisper CLI (not yet widely available)
function runFasterWhisperCli() {
  return Promise.reject(new Error('faster-whisper CLI not available'));
}

module.exports = { transcribe };
