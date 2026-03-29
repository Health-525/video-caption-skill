'use strict';

const fs = require('fs');

// ─── Parse VTT into cue objects ──────────────────────────────────────────────
// Each cue: { start: seconds, end: seconds, text: string }
function parseVtt(vttContent) {
  const cues = [];
  const blocks = vttContent.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const tsIdx = lines.findIndex(l => l.includes(' --> '));
    if (tsIdx === -1) continue;

    const [startStr, endStrRaw] = lines[tsIdx].split(' --> ');
    // drop settings after end time: "00:00:03.000 align:start position:0%"
    const endStr = (endStrRaw || '').trim().split(/\s+/)[0];
    const start = parseSecs(startStr);
    const end   = parseSecs(endStr);
    if (isNaN(start) || isNaN(end)) continue;

    const text = lines.slice(tsIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();

    if (text) cues.push({ start, end, text });
  }
  return cues;
}

function parseSecs(str) {
  const parts = str.trim().split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return NaN;
}

function secsToTimestamp(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(0).padStart(2, '0');
  return h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${ss}`
    : `${String(m).padStart(2,'0')}:${ss}`;
}

// ─── Merge cues within time window ───────────────────────────────────────────
function mergeCues(cues, mergeWindowSecs) {
  if (!cues.length) return [];

  // Step 1: deduplicate consecutive identical / overlapping text
  const deduped = [cues[0]];
  for (let i = 1; i < cues.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (cues[i].text === prev.text) {
      prev.end = cues[i].end;
      continue;
    }
    if (prev.text.endsWith(cues[i].text) || cues[i].text.startsWith(prev.text)) {
      prev.text = cues[i].text;
      prev.end  = cues[i].end;
      continue;
    }
    deduped.push({ ...cues[i] });
  }

  // Step 2: merge within time window
  const segments = [];
  let cur = { ...deduped[0] };
  for (let i = 1; i < deduped.length; i++) {
    const c = deduped[i];
    if (c.start - cur.end <= mergeWindowSecs) {
      cur.text = smartJoin(cur.text, c.text);
      cur.end  = c.end;
    } else {
      segments.push(cur);
      cur = { ...c };
    }
  }
  segments.push(cur);
  return segments;
}

// ─── Smart text join (CJK-aware) ─────────────────────────────────────────────
function smartJoin(a, b) {
  if (!a) return b;
  if (!b) return a;
  const lastChar  = a[a.length - 1];
  const firstChar = b[0];
  const isCJK = c => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c);
  if (isCJK(lastChar) || isCJK(firstChar)) return a + b;
  if (lastChar === ' ') return a + b;
  return a + ' ' + b;
}

// ─── Sentence-end punctuation regex ──────────────────────────────────────────
const SENT_END = /[。！？!?]["」』)）]?$/;

// ─── Split merged VTT segments into paragraphs ───────────────────────────────
// Rules (applied in order):
//   A. Sentence-end punctuation  → flush paragraph  (when splitPunct=true)
//   B. Accumulated length >= paraMaxChars → flush paragraph  (always, fallback)
//
// opts:
//   splitPunct   {boolean}  default true
//   paraMaxChars {number}   default 240
function toParagraphs(segments, { splitPunct = true, paraMaxChars = 240 } = {}) {
  const paragraphs = [];
  let buf = null;

  const flush = () => { paragraphs.push(buf); buf = null; };

  for (const seg of segments) {
    if (!buf) {
      buf = { ...seg };
    } else {
      buf.text = smartJoin(buf.text, seg.text);
      buf.end  = seg.end;
    }
    const t = buf.text.trim();
    if (splitPunct && SENT_END.test(t)) { flush(); continue; }
    if (t.length >= paraMaxChars)        { flush(); }
  }
  if (buf) paragraphs.push(buf);
  return paragraphs;
}

// ─── Split plain Whisper transcript into paragraphs ──────────────────────────
// opts:
//   splitPunct   {boolean}  default true
//   paraMaxChars {number}   default 240
function splitTranscript(text, { splitPunct = true, paraMaxChars = 240 } = {}) {
  // 1. flatten (Whisper may emit \n per segment)
  const flat = text.replace(/\r?\n+/g, ' ').trim();

  // 2. insert split markers after sentence-ending punctuation
  const marked = splitPunct
    ? flat.replace(/([。！？!?]["」』)）]?)/g, '$1\n')
    : flat;

  // 3. collect sentences
  const sentences = marked.split('\n').map(s => s.trim()).filter(Boolean);

  // 4. group into paragraphs, flush when length hits paraMaxChars
  const paras = [];
  let cur = '';
  for (const s of sentences) {
    const joined = cur ? smartJoin(cur, s) : s;
    // If adding this sentence would exceed limit AND cur is non-empty, flush first
    if (cur && joined.length > paraMaxChars) {
      paras.push(cur);
      cur = s;
    } else {
      cur = joined;
      if (cur.length >= paraMaxChars) { paras.push(cur); cur = ''; }
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

// ─── Build markdown header ───────────────────────────────────────────────────
function buildHeader(meta, source) {
  const labels = { native: '原生字幕', auto: '自动字幕（机器翻译）', whisper: 'Whisper 转写' };
  return [
    `# ${meta.title || 'Untitled'}`,
    '',
    `| 字段 | 内容 |`,
    `|------|------|`,
    `| 频道 | ${meta.channel || '-'} |`,
    `| 发布日期 | ${meta.uploadDate || '-'} |`,
    `| 原始链接 | [${meta.url}](${meta.url}) |`,
    `| 字幕来源 | ${labels[source] || source} |`,
    '',
    '---',
    '',
  ].join('\n');
}

// ─── Main export ─────────────────────────────────────────────────────────────
function vttToMd(vttFile, meta, { source, keepTimestamps, mergeWindow, splitPunct, paraMaxChars }) {
  const raw      = fs.readFileSync(vttFile, 'utf8');
  const cues     = parseVtt(raw);
  const segments = mergeCues(cues, mergeWindow);
  const paras    = toParagraphs(segments, { splitPunct, paraMaxChars });

  const header = buildHeader(meta, source);
  const body   = paras.map(p =>
    keepTimestamps ? `**[${secsToTimestamp(p.start)}]** ${p.text}` : p.text
  ).join('\n\n');

  return header + body + '\n';
}

module.exports = { vttToMd, parseVtt, mergeCues, toParagraphs, splitTranscript };
