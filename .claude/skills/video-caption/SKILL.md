---
name: video-caption
version: 1.0.0
description: "Extract subtitles from YouTube videos and convert to Markdown notes. Trigger: user provides YouTube URL and asks to extract subtitles, captions, or notes. Actions: extract, download, convert, subtitle, caption, transcribe, note. Tools: yt-dlp and Node.js. Fallback: faster-whisper when no native subtitles. OS: Windows, macOS, Linux."
metadata:
  openclaw:
    requires:
      bins:
        - yt-dlp
        - node
---

# Video Caption -> Markdown Note

Extract subtitles from a YouTube video and convert to a clean Markdown file.

## When to Apply

Use this skill when the user:
- Provides a YouTube URL and asks to extract subtitles or notes
- Says "extract subtitle", "convert to note", "download caption", "帮我提取字幕", "转为笔记"
- Wants to save video content as a readable Markdown file

---

## How to Use This Skill

### Step 1: Check Available Subtitles

Always check first:

```bash
yt-dlp --list-subs "VIDEO_URL" --cookies youtube_cookies.txt
```

Look for:
- `zh-Hans` — Native Simplified Chinese
- `zh-Hans-en` — Auto-translated from English (most common)
- `en` — Native English

If empty → go to **Fallback: Whisper** section.

---

### Step 2: Download Subtitles (VTT)

**macOS / Linux:**

```bash
yt-dlp --skip-download --write-subs --write-auto-subs \
  --sub-langs "zh-Hans,zh-Hans-en,en" \
  --sub-format vtt \
  --output "%(id)s" \
  --cookies youtube_cookies.txt \
  "VIDEO_URL"
```

**Windows CMD:**

```cmd
yt-dlp --skip-download --write-subs --write-auto-subs ^
  --sub-langs "zh-Hans,zh-Hans-en,en" ^
  --sub-format vtt ^
  --output "%(id)s" ^
  --cookies youtube_cookies.txt ^
  "VIDEO_URL"
```

Output: `VIDEO_ID.zh-Hans-en.vtt` in current directory.

---

### Step 3: Convert VTT to Markdown

**Important:** Always write a `.js` file and run with `node`. Never use `node -e` multiline on Windows CMD — it breaks.

Create `vtt2md.js`:

```js
const fs = require('fs');
const path = require('path');

const INPUT  = process.env.VTT_FILE  || 'VIDEO_ID.zh-Hans-en.vtt';
const OUTPUT = process.env.OUT_FILE  || 'output.md';
const TITLE  = process.env.TITLE     || 'Video Title';
const URL    = process.env.VIDEO_URL || 'https://www.youtube.com/watch?v=VIDEO_ID';

const lines = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/);
const texts = [];
let prev = '';

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
  if (/^\d{2}:\d{2}:\d{2}/.test(line)) continue;
  if (line === prev) continue;
  prev = line;
  texts.push(line);
}

const md = `# ${TITLE}\n\n> Source: [${TITLE}](${URL})\n\n---\n\n` + texts.join('\n');
fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
fs.writeFileSync(OUTPUT, md, 'utf8');
console.log(`done: ${texts.length} lines -> ${OUTPUT}`);
```

**macOS / Linux:**

```bash
VTT_FILE=VIDEO_ID.zh-Hans-en.vtt OUT_FILE=./YYYY-MM-DD.md TITLE="My Video" VIDEO_URL="https://..." node vtt2md.js
rm vtt2md.js
```

**Windows CMD:**

```cmd
set VTT_FILE=VIDEO_ID.zh-Hans-en.vtt
set OUT_FILE=.\YYYY-MM-DD.md
set TITLE=My Video
set VIDEO_URL=https://www.youtube.com/watch?v=VIDEO_ID
node vtt2md.js
del vtt2md.js
```

---

### Step 4: Cleanup

```bash
rm VIDEO_ID*.vtt        # macOS / Linux
```

```cmd
del VIDEO_ID*.vtt       :: Windows
```

---

## Prerequisites

### yt-dlp

```bash
pip install yt-dlp
pip install -U yt-dlp   # keep updated
```

### youtube_cookies.txt

Required to bypass YouTube rate limits.

1. Install Chrome extension: **Get cookies.txt LOCALLY**
2. Open `youtube.com` while logged in
3. Click extension → Export → Netscape format
4. Save as `youtube_cookies.txt` in your working directory
5. **Add to `.gitignore`** — never commit this file

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Sign in to confirm not a bot` | Missing or expired cookies | Re-export cookies |
| `429 Too Many Requests` | Rate limited | `pip install -U yt-dlp` + use cookies |
| `n challenge solving failed` | Needs JS runtime | Add `--js-runtimes node` flag |
| `--list-subs` empty | No subtitles exist | Use Whisper fallback |
| Garbled / encoding issues | Wrong encoding | Always use `utf8` in Node.js |
| `node -e` fails on Windows | CMD quote parsing bug | Write `.js` file, run `node file.js` |

---

## Fallback: Whisper (No Native Subtitles)

> **Windows warning:** `faster-whisper` may crash with `0xC0000005` (ctranslate2 Segfault).
> Always try native subtitles first.

### Setup

```bash
python -m venv .venv
source .venv/bin/activate    # macOS / Linux
# .venv\Scripts\activate     # Windows
pip install yt-dlp imageio-ffmpeg faster-whisper
```

### Download Audio

```bash
yt-dlp --extract-audio --audio-format mp3 \
  --output "%(id)s.%(ext)s" \
  --cookies youtube_cookies.txt \
  "VIDEO_URL"
```

### Transcribe (save as `whisper_run.py`)

```python
from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe("VIDEO_ID.mp3", beam_size=5, vad_filter=False)

with open("transcript.txt", "w", encoding="utf-8") as f:
    for seg in segments:
        f.write(seg.text + "\n")
```

If Segfault (`0xC0000005`): `ctranslate2` is incompatible with this environment. Revert to native subtitles.

---

## Output Format

```markdown
# Video Title

> Source: [Video Title](VIDEO_URL)

---

subtitle line 1
subtitle line 2
...
```
