---
name: youtube-subtitle
description: "Extract subtitles from YouTube videos and convert to Markdown notes. Actions: extract, download, convert, transcribe, subtitle, caption, note, summarize. Sources: YouTube URL, video ID. Output: Markdown file. Tools: yt-dlp, Node.js. Fallback: faster-whisper Whisper transcription when no native subtitles. Platform: Windows CMD. Topics: youtube subtitle vtt markdown note-taking yt-dlp whisper cookies."
---

# YouTube Subtitle → Markdown Note

Extract subtitles from a YouTube video and convert them into a clean Markdown note file.

## When to Apply

Use this skill when the user:
- Provides a YouTube URL and wants subtitles or notes extracted
- Says "帮我提取字幕"、"转为笔记"、"下载字幕"
- Wants to save video content as a readable Markdown file

---

## How to Use This Skill

### Step 1: Check for Available Subtitles

Always check first. Run:

```cmd
yt-dlp --list-subs "VIDEO_URL" --cookies youtube_cookies.txt
```

Look for subtitle languages in output:
- `zh-Hans` — Native Simplified Chinese
- `zh-Hans-en` — Auto-translated from English (most common)
- `en` — Native English

If output is empty → skip to **Fallback: Whisper**.

---

### Step 2: Download Subtitles (VTT format)

```cmd
yt-dlp --skip-download --write-subs --write-auto-subs ^
  --sub-langs "zh-Hans,zh-Hans-en,en" ^
  --sub-format vtt ^
  --output "%(id)s" ^
  --cookies youtube_cookies.txt ^
  "VIDEO_URL"
```

Output file: `VIDEO_ID.zh-Hans-en.vtt` (saved in current directory)

---

### Step 3: Convert VTT → Markdown

Write this as a file `vtt2md.js` (never use `node -e` multiline on CMD — it breaks):

```js
const fs = require('fs');

const INPUT  = process.env.VTT_FILE  || 'VIDEO_ID.zh-Hans-en.vtt';  // path to downloaded .vtt
const OUTPUT = process.env.OUT_FILE  || 'YYYY-MM-DD-VIDEO_ID.md';   // output markdown path
const TITLE  = process.env.TITLE     || 'Video Title';
const URL    = process.env.VIDEO_URL || 'https://www.youtube.com/watch?v=VIDEO_ID';

const content = fs.readFileSync(INPUT, 'utf8');
const lines = content.split(/\r?\n/);
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

const md = `# ${TITLE}\n\n> 来源：[${TITLE}](${URL})\n\n---\n\n` + texts.join('\n');
fs.writeFileSync(OUTPUT, md, 'utf8');
console.log(`done, ${texts.length} lines -> ${OUTPUT}`);
```

```cmd
# Windows
set VTT_FILE=C:/temp/VIDEO_ID.zh-Hans-en.vtt
set OUT_FILE=./YYYY-MM-DD-VIDEO_ID.md
set TITLE=视频标题
set VIDEO_URL=https://www.youtube.com/watch?v=VIDEO_ID
node vtt2md.js
del vtt2md.js
```

```bash
# macOS / Linux
VTT_FILE=/tmp/VIDEO_ID.zh-Hans-en.vtt OUT_FILE=./YYYY-MM-DD-VIDEO_ID.md TITLE="视频标题" VIDEO_URL="https://..." node vtt2md.js
rm vtt2md.js
```

---

### Step 4: Cleanup

```cmd
# Windows
del VIDEO_ID*.vtt
```

```bash
# macOS / Linux
rm VIDEO_ID*.vtt
```

---

## Prerequisites

### yt-dlp

```cmd
pip install yt-dlp
pip install -U yt-dlp
```

### youtube_cookies.txt (Required to bypass rate limits)

1. Install Chrome extension: **Get cookies.txt LOCALLY**
2. Open `youtube.com` while logged in
3. Click extension → Export (Netscape format)
4. Save as `youtube_cookies.txt` in the project directory
5. Add to `.gitignore` — never commit this file

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Sign in to confirm you're not a bot` | Missing or expired cookies | Re-export cookies |
| `429 Too Many Requests` | Rate limited | `pip install -U yt-dlp` then retry with cookies |
| `n challenge solving failed` | JS runtime missing | Add `--js-runtimes node` flag |
| `--list-subs` empty | No subtitles available | Use Whisper fallback below |
| Garbled output / encoding issues | Wrong encoding | Always read/write with `utf8` in Node.js |
| `node -e` multiline fails on CMD | CMD quote parsing bug | Always write a `.js` file and run `node file.js` |

---

## Fallback: Whisper Transcription (No Native Subtitles)

> Windows warning: `faster-whisper` may crash with exit code `0xC0000005` (ctranslate2 Segfault).
> Always try native subtitles first. Only use this when `--list-subs` returns nothing.

### Setup (use venv to isolate)

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install yt-dlp imageio-ffmpeg faster-whisper
```

### Download Audio

```cmd
yt-dlp --extract-audio --audio-format mp3 ^
  --output "%(id)s.%(ext)s" ^
  --cookies youtube_cookies.txt ^
  "VIDEO_URL"
```

### Transcribe

```python
from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe("C:/temp/VIDEO_ID.mp3", beam_size=5, vad_filter=False)

with open("transcript.txt", "w", encoding="utf-8") as f:
    for seg in segments:
        f.write(seg.text + "\n")
```

If Segfault occurs (exit code `0xC0000005`): `ctranslate2` is incompatible with this Windows environment. No universal fix — revert to native subtitles.

---

## Output File Convention

Path: `YYYY-MM-DD-VIDEO_ID.md` (any directory you choose)

Format:
```markdown
# 视频标题

> 来源：[视频标题](VIDEO_URL)

---

subtitle line 1
subtitle line 2
...
```
