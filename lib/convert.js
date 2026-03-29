'use strict';

const fs = require('fs');

// ─── Parse VTT into cue objects ──────────────────────────────────────────────
// Each cue: { start: seconds, end: seconds, text: string }
function parseVtt(vttContent) {
  const cues = [];
  const blocks = vttContent.replace(/\r\n/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    // find the timestamp line
    const tsIdx = lines.findIndex(l => l.includes(' --> '));
    if (tsIdx === -1) continue;

    const [startStr, endStrRaw] = lines[tsIdx].split(' --> ');
    // drop settings after end time: "00:00:03.000 align:start position:0%"
    const endStr = (endStrRaw || '').trim().split(/\s+/)[0];
    const start = parseSecs(startStr);
    const end   = parseSecs(endStr);
    if (isNaN(start) || isNaN(end)) continue;

    // text lines after the timestamp (strip VTT tags like <c>, <00:00:00.000>)
    const text = lines.slice(tsIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')   // strip tags
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
  // HH:MM:SS.mmm or MM:SS.mmm
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

// ─── Merge cues into paragraphs ──────────────────────────────────────────────
// Strategy:
//   1. Deduplicate consecutive identical lines (common in auto-subs)
//   2. Merge cues within mergeWindow seconds into one segment
//   3. Detect sentence boundaries (。！？.!?) to split paragraphs
function mergeCues(cues, mergeWindowSecs) {
  if (!cues.length) return [];

  // Step 1: deduplicate consecutive identical text
  const deduped = [cues[0]];
  for (let i = 1; i < cues.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (cues[i].text === prev.text) {
      prev.end = cues[i].end;   // extend end time
      continue;
    }
    // also skip if current text is a suffix/prefix overlap of previous
    // (auto-subs often slide a window over the same sentence)
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
      // merge: smart join (avoid double spaces, handle CJK no-space)
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

// Join two subtitle fragments intelligently
function smartJoin(a, b) {
  if (!a) return b;
  if (!b) return a;
  const lastChar  = a[a.length - 1];
  const firstChar = b[0];
  // CJK characters — no space needed
  const isCJK = c => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c);
  if (isCJK(lastChar) || isCJK(firstChar)) return a + b;
  // already ends with space
  if (lastChar === ' ') return a + b;
  return a + ' ' + b;
}

// ─── Split segments into paragraphs ──────────────────────────────────────────
function toParagraphs(segments) {
  const sentenceEnd = /[。！？.!?]["」』)）]?$/;
  const paragraphs = [];
  let buf = null;

  for (const seg of segments) {
    if (!buf) {
      buf = { ...seg };
    } else {
      buf.text = smartJoin(buf.text, seg.text);
      buf.end  = seg.end;
    }
    // break paragraph at sentence boundaries
    if (sentenceEnd.test(buf.text.trim())) {
      paragraphs.push(buf);
      buf = null;
    }
  }
  if (buf) paragraphs.push(buf);
  return paragraphs;
}

// ─── Build markdown header ───────────────────────────────────────────────────
function buildHeader(meta, source) {
  const labels = { native: '原生字幕', auto: '自动字幕（机器翻译）', whisper: 'Whisper 转写' };
  const lines = [
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
  ];
  return lines.join('\n');
}

// ─── Main export ─────────────────────────────────────────────────────────────
function vttToMd(vttFile, meta, { source, keepTimestamps, mergeWindow }) {
  const raw      = fs.readFileSync(vttFile, 'utf8');
  const cues     = parseVtt(raw);
  const segments = mergeCues(cues, mergeWindow);
  const paras    = toParagraphs(segments);

  const header = buildHeader(meta, source);

  const body = paras.map(p => {
    if (keepTimestamps) {
      return `**[${secsToTimestamp(p.start)}]** ${p.text}`;
    }
    return p.text;
  }).join('\n\n');

  return header + body + '\n';
}

module.exports = { vttToMd, parseVtt, mergeCues };
