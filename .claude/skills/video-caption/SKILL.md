---
name: video-caption
version: 2.0.0
description: "Extract subtitles from YouTube videos and convert to Markdown notes. Trigger: user provides YouTube URL and asks to extract subtitles, captions, or notes. Actions: extract, download, convert, subtitle, caption, transcribe, note, 提取字幕, 转为笔记. Tools: yt-dlp and Node.js CLI. Output: Markdown file with title, channel, date, source label. Fallback: Whisper when no native subtitles."
metadata:
  openclaw:
    requires:
      bins:
        - yt-dlp
        - node
---

# Video Caption Skill

Extracts subtitles from a YouTube video and saves a clean Markdown note with metadata.

## When to Apply

- User provides a YouTube URL and asks to extract subtitles / captions / notes
- Keywords: "extract subtitle", "convert to note", "download caption", "帮我提取字幕", "转为笔记", "整理成笔记"

---

## Setup (one-time)

```bash
cd /path/to/video-caption-skill
npm install   # no external deps, just registers the bin
```

Or install globally:

```bash
npm install -g /path/to/video-caption-skill
```

### youtube_cookies.txt (required for rate-limit bypass)

1. Install Chrome extension: **Get cookies.txt LOCALLY**
2. Open `youtube.com` while logged in → Export → Netscape format
3. Save as `youtube_cookies.txt` in your working directory
4. The file is listed in `.gitignore` — never commit it

---

## How to Use This Skill

### Basic usage

```bash
node bin/video-caption.js <youtube_url>
```

Output: `notes/YYYY-MM-DD-VIDEO_ID.md`

### With options

```bash
node bin/video-caption.js <youtube_url> \
  --out "notes/%(id)s.md" \
  --lang "zh-Hans,zh-Hans-en,en" \
  --cookies youtube_cookies.txt \
  --merge-window 4
```

### All options

| Option | Default | Description |
|--------|---------|-------------|
| `--out <template>` | `notes/%Y-%m-%d-%(id)s.md` | Output path. Supports `%Y-%m-%d`, `%(id)s`, `%(title)s` |
| `--lang <langs>` | `zh-Hans,zh-Hans-en,en` | Subtitle language priority (comma-separated) |
| `--cookies <file>` | `youtube_cookies.txt` | Cookies file path |
| `--merge-window <s>` | `4` | Merge subtitle lines within N seconds into one segment |
| `--keep-timestamps` | off | Prefix each paragraph with `[MM:SS]` |
| `--whisper` | off | Force Whisper even if subtitles exist |

### If running via Claude (no global install)

```bash
node bin/video-caption.js "VIDEO_URL"
```

Claude will run this command from the repo root.

---

## Output Format

```markdown
# Video Title

| 字段 | 内容 |
|------|------|
| 频道 | Channel Name |
| 发布日期 | 2024-01-15 |
| 原始链接 | https://... |
| 字幕来源 | 自动字幕（机器翻译） |

---

Merged paragraph one with full sentences here.

Merged paragraph two continues here.
```

**字幕来源** labels:
- `原生字幕` — native human subtitles
- `自动字幕（机器翻译）` — YouTube auto-generated
- `Whisper 转写` — local AI transcription fallback

---

## Whisper Fallback

Whisper runs automatically when `--list-subs` returns no results, or when `--whisper` flag is set.

Requires:

```bash
pip install faster-whisper
```

> **Windows:** `faster-whisper` may crash with `0xC0000005` (ctranslate2 Segfault).
> This is a known incompatibility. Prefer videos with native subtitles on Windows.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Sign in to confirm not a bot` | Missing/expired cookies | Re-export `youtube_cookies.txt` |
| `429 Too Many Requests` | Rate limited | `pip install -U yt-dlp` + use cookies |
| `n challenge solving failed` | Needs JS runtime | Run `yt-dlp --update` |
| No VTT file downloaded | No subtitles for chosen lang | Try `--lang en` or `--whisper` |
| `0xC0000005` Segfault | Windows + ctranslate2 | Use a video with native subtitles |
