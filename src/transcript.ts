import * as fs from 'fs';
import * as path from 'path';

import { claudeHome } from './sessionStore';

const TAIL_BYTES = 64 * 1024;

export interface TranscriptTail {
  title?: string;
  lastPrompt?: string;
}

interface CacheEntry {
  mtimeMs: number;
  tail: TranscriptTail;
}

const cache = new Map<string, CacheEntry>();

/** Resolved transcript locations, keyed by session id. Negatives expire so a
 *  session whose transcript appears late is picked up. */
const pathCache = new Map<string, { file?: string; checkedAt: number }>();
const NEGATIVE_TTL_MS = 30_000;

/**
 * Locate ~/.claude/projects/<slug>/<sessionId>.jsonl.
 *
 * The slug is the cwd with separators flattened, but the exact substitution is
 * not documented, so try the likely spellings and then fall back to scanning the
 * project directories. There are a few dozen of them, so the scan is cheap and
 * only happens on a miss.
 */
export function transcriptPath(cwd: string, sessionId: string): string | undefined {
  const cached = pathCache.get(sessionId);
  if (cached && (cached.file || Date.now() - cached.checkedAt < NEGATIVE_TTL_MS)) {
    return cached.file;
  }

  const file = resolveTranscript(cwd, sessionId);
  pathCache.set(sessionId, { file, checkedAt: Date.now() });
  return file;
}

function resolveTranscript(cwd: string, sessionId: string): string | undefined {
  const projects = path.join(claudeHome(), 'projects');
  const candidates = [cwd.replace(/\//g, '-'), cwd.replace(/[^a-zA-Z0-9]/g, '-')];

  for (const slug of candidates) {
    const file = path.join(projects, slug, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) {
      return file;
    }
  }

  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return undefined;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) {
      return file;
    }
  }
  return undefined;
}

/**
 * Read the last chunk of a transcript for its AI title and most recent prompt.
 *
 * These files run to hundreds of megabytes in aggregate, so never read one
 * whole. Row labels call this on every render, which is affordable only because
 * the result is cached against the file's mtime: an unchanged transcript costs
 * one stat, and a changed one costs a single 64KB read from the end.
 */
export function readTail(cwd: string, sessionId: string): TranscriptTail {
  const file = transcriptPath(cwd, sessionId);
  if (!file) {
    return {};
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return {};
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.tail;
  }

  const start = Math.max(0, stat.size - TAIL_BYTES);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);

  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, start);
  } catch {
    return {};
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }

  const lines = buffer.toString('utf8').split('\n');
  if (start > 0) {
    lines.shift(); // Partial first line from slicing mid-file.
  }

  const tail: TranscriptTail = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) {
      continue;
    }
    let record: { type?: string; aiTitle?: string; lastPrompt?: string };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!tail.title && record.type === 'ai-title' && record.aiTitle) {
      tail.title = record.aiTitle;
    }
    if (!tail.lastPrompt && record.type === 'last-prompt' && record.lastPrompt) {
      tail.lastPrompt = record.lastPrompt;
    }
    if (tail.title && tail.lastPrompt) {
      break;
    }
  }

  cache.set(file, { mtimeMs: stat.mtimeMs, tail });
  return tail;
}
