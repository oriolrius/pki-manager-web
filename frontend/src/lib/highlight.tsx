import type { ReactNode } from 'react';

/**
 * Tiny dependency-free syntax highlighter for the small, well-known snippet
 * shapes we render in ConfigSnippet (shell one-liners, ssh_config drop-ins, and
 * SSH public-key / known_hosts blobs). It returns React nodes — no HTML string
 * injection — so content is escaped by React automatically.
 *
 * Deliberately not a general lexer: it recognises just enough structure
 * (comments, the leading command/keyword, flags, <placeholders>, key algorithms)
 * to make the blocks scannable in both light and dark themes.
 */
export type CodeLanguage = 'shell' | 'ssh_config' | 'blob';

const COLOR = {
  comment: 'text-emerald-600 dark:text-emerald-400',
  keyword: 'text-sky-700 dark:text-sky-400',
  flag: 'text-amber-600 dark:text-amber-400',
  placeholder: 'text-violet-600 dark:text-violet-400',
  marker: 'text-fuchsia-600 dark:text-fuchsia-400',
  muted: 'text-muted-foreground',
} as const;

/** Split a line into tokens while preserving the whitespace runs between them. */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t !== '');
}

const isSpace = (t: string) => /^\s+$/.test(t);
const isPlaceholder = (t: string) => /[<>]/.test(t) || t === '*';
const isBase64Blob = (t: string) => /^[A-Za-z0-9+/]{20,}={0,2}$/.test(t);
const isKeyAlgo = (t: string) => /^(ssh-|ecdsa-|rsa-|sk-)/.test(t);

const SSH_CONFIG_KEYWORDS = new Set([
  'Host',
  'HostName',
  'User',
  'Port',
  'IdentityFile',
  'CertificateFile',
  'IdentitiesOnly',
  'ProxyJump',
  'ForwardAgent',
]);

function span(cls: string, text: string, key: string): ReactNode {
  return (
    <span key={key} className={cls}>
      {text}
    </span>
  );
}

function shellLine(line: string, base: string): ReactNode {
  if (line.trimStart().startsWith('#')) return span(`${COLOR.comment} italic`, line, base);
  let seenCommand = false;
  return tokenize(line).map((tok, i) => {
    const key = `${base}-${i}`;
    if (isSpace(tok)) return tok;
    if (isPlaceholder(tok)) return span(COLOR.placeholder, tok, key);
    if (tok.startsWith('-')) return span(COLOR.flag, tok, key);
    if (!seenCommand) {
      seenCommand = true;
      return span(`${COLOR.keyword} font-medium`, tok, key);
    }
    return tok;
  });
}

function sshConfigLine(line: string, base: string): ReactNode {
  let seenKeyword = false;
  return tokenize(line).map((tok, i) => {
    const key = `${base}-${i}`;
    if (isSpace(tok)) return tok;
    if (!seenKeyword && SSH_CONFIG_KEYWORDS.has(tok)) {
      seenKeyword = true;
      return span(COLOR.keyword, tok, key);
    }
    seenKeyword = true;
    if (isPlaceholder(tok)) return span(COLOR.placeholder, tok, key);
    return tok;
  });
}

/** SSH public keys and known_hosts lines: `[@marker] [pattern] <algo> <base64> [comment]`. */
function blobLine(line: string, base: string): ReactNode {
  let seenBase64 = false;
  return tokenize(line).map((tok, i) => {
    const key = `${base}-${i}`;
    if (isSpace(tok)) return tok;
    if (tok.startsWith('@')) return span(COLOR.marker, tok, key);
    if (isPlaceholder(tok)) return span(COLOR.placeholder, tok, key);
    if (isKeyAlgo(tok)) return span(COLOR.keyword, tok, key);
    if (isBase64Blob(tok)) {
      seenBase64 = true;
      return tok;
    }
    // Trailing free-text (the key comment / CA label) reads as a comment.
    return seenBase64 ? span(COLOR.muted, tok, key) : tok;
  });
}

export function highlightCode(content: string, language: CodeLanguage): ReactNode {
  const lineFn =
    language === 'shell' ? shellLine : language === 'ssh_config' ? sshConfigLine : blobLine;
  const lines = content.split('\n');
  return lines.map((line, i) => (
    <span key={i}>
      {lineFn(line, String(i))}
      {i < lines.length - 1 ? '\n' : ''}
    </span>
  ));
}
