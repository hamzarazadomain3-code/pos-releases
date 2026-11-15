/**
 * The message sanitizer — markdown-lite, safe by construction.
 *
 * The assistant's answer is rendered with React elements, NEVER with
 * `dangerouslySetInnerHTML`. This module turns the raw text into a small
 * structure (blocks + runs) and drops everything that is not plain text:
 *
 *   - every HTML tag is removed (so `<script>`, `<img onerror>` and `<iframe>`
 *     are simply not there),
 *   - no URL is ever turned into a link,
 *   - only `**bold**`, `*italic*` and `` `code` `` are understood.
 *
 * The test feeds it real XSS strings and checks that nothing survives.
 */

export interface SafeRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type SafeBlockType = 'paragraph' | 'bullet' | 'numbered';

export interface SafeBlock {
  type: SafeBlockType;
  runs: SafeRun[];
}

/** The HTML tags that are removed (the whole tag, with its attributes). */
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
/** A comment or a CDATA section. */
const COMMENT_RE = /<!--[\s\S]*?-->/g;
/** A javascript:/data: URL — there is no link in markdown-lite, but the
 *  text is kept as plain text so it can never become one. */
const DANGEROUS_URL_RE = /(javascript|data|vbscript)\s*:/gi;

/** Strip everything that is not plain text. */
export function stripHtml(text: string): string {
  return String(text ?? '')
    .replace(COMMENT_RE, '')
    .replace(TAG_RE, '')
    .replace(DANGEROUS_URL_RE, '$1-blocked:');
}

/**
 * Turn one line into runs (bold / italic / code).
 *
 * The markers are matched in one pass, so a `**` inside a code span does not
 * open a bold run.
 */
export function parseRuns(line: string): SafeRun[] {
  const runs: SafeRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

/**
 * The safe structure of a message.
 *
 * A bullet is a line that starts with "- " or "* ", a numbered item starts
 * with "1. ", everything else is a paragraph. The lines are joined into one
 * paragraph until a blank line.
 */
export function sanitizeMessage(text: string): SafeBlock[] {
  const clean = stripHtml(text ?? '');
  const blocks: SafeBlock[] = [];
  let paragraph: SafeRun[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', runs: paragraph });
      paragraph = [];
    }
  };

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') {
      flush();
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', runs: parseRuns(bullet[1]) });
      continue;
    }
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push({ type: 'numbered', runs: parseRuns(numbered[2]) });
      continue;
    }
    paragraph.push(...parseRuns(line));
  }
  flush();
  return blocks;
}

/** The plain text of a message (for the copy button). */
export function sanitizePlainText(text: string): string {
  return stripHtml(text ?? '').replace(/\r\n/g, '\n').trim();
}
