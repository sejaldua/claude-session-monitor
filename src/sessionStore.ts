import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { isPidAlive, socketLooksLive } from './liveness';
import { RawSessionFile, Session, SessionStatus, STATUS_ORDER } from './types';

const CONFIG = 'claudeSessionMonitor';

export function claudeHome(): string {
  const override = vscode.workspace.getConfiguration(CONFIG).get<string>('claudeHome')?.trim();
  if (override) {
    return override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override;
  }
  return path.join(os.homedir(), '.claude');
}

export function sessionsDir(): string {
  return path.join(claudeHome(), 'sessions');
}

function isStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && (STATUS_ORDER as string[]).includes(value);
}

/**
 * Collapse records that describe the same chat.
 *
 * One chat can be served by several live processes: opening it twice launches
 * two `claude --resume=<sessionId>` processes, each writing its own
 * sessions/<pid>.json with its own derived name and its own status. Keyed by
 * pid alone that chat appears once per process, and because the statuses are
 * independent the rows can land in different groups, so the same chat shows up
 * under both Working and Idle.
 *
 * The survivor is the one whose status most needs attention (STATUS_ORDER is
 * already most-interesting-first), then the most recently updated. Picking by
 * recency alone would let an idle duplicate hide a sibling that is waiting on a
 * permission prompt, which is the one thing this view exists to surface.
 */
function dedupeBySession(sessions: Session[]): Session[] {
  const winners = new Map<string, Session>();

  for (const session of sessions) {
    const current = winners.get(session.sessionId);
    if (!current || outranks(session, current)) {
      winners.set(session.sessionId, session);
    }
  }

  return [...winners.values()];
}

function outranks(candidate: Session, incumbent: Session): boolean {
  const byStatus =
    STATUS_ORDER.indexOf(candidate.status) - STATUS_ORDER.indexOf(incumbent.status);
  if (byStatus !== 0) {
    return byStatus < 0;
  }
  if (candidate.statusUpdatedAt !== incumbent.statusUpdatedAt) {
    return candidate.statusUpdatedAt > incumbent.statusUpdatedAt;
  }
  // Fully tied: pick deterministically so the row does not flap between polls.
  return candidate.pid > incumbent.pid;
}

/**
 * Reads ~/.claude/sessions/*.json, drops dead and malformed records, and
 * notifies listeners when the resulting set changes.
 *
 * Both a directory watch and a poll are needed. The watch reacts to status
 * transitions immediately; the poll is the only thing that notices a session
 * whose process exited, because that leaves the stale file on disk and fires no
 * filesystem event.
 */
export class SessionStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _sessions: Session[] = [];
  private _error: string | undefined;
  private signature = '';

  private watcher: fs.FSWatcher | undefined;
  private watchedDir: string | undefined;
  private poll: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly log: vscode.OutputChannel) {}

  get sessions(): Session[] {
    return this._sessions;
  }

  get error(): string | undefined {
    return this._error;
  }

  byStatus(status: SessionStatus): Session[] {
    return this._sessions.filter((s) => s.status === status);
  }

  start(): void {
    this.attachWatcher();
    this.restartPoll();
    this.refresh();
  }

  /** Re-read config-derived state after a settings change. */
  reconfigure(): void {
    if (this.watchedDir !== sessionsDir()) {
      this.attachWatcher();
    }
    this.restartPoll();
    this.refresh();
  }

  refresh(): void {
    if (this.disposed) {
      return;
    }
    const dir = sessionsDir();
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      this._error = undefined;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // A missing directory is the normal "no sessions have ever run" state.
      this._error = code === 'ENOENT' ? undefined : `Could not read ${dir}: ${String(err)}`;
      this.publish([]);
      return;
    }

    const stuckAfterMs =
      Math.max(1, vscode.workspace.getConfiguration(CONFIG).get<number>('stuckAfterMinutes') ?? 15) *
      60_000;
    const now = Date.now();
    const sessions: Session[] = [];

    for (const entry of entries) {
      const session = this.readOne(path.join(dir, entry), now, stuckAfterMs);
      if (session) {
        sessions.push(session);
      }
    }

    const deduped = dedupeBySession(sessions);

    deduped.sort((a, b) => {
      const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return byStatus !== 0 ? byStatus : b.statusUpdatedAt - a.statusUpdatedAt;
    });

    this.publish(deduped);
  }

  private readOne(file: string, now: number, stuckAfterMs: number): Session | undefined {
    let raw: RawSessionFile;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawSessionFile;
    } catch {
      return undefined; // Half-written file; the next poll will pick it up.
    }

    // A record with no status is a leftover from an ungracefully exited
    // session. These accumulate, and since derived names are not unique over
    // time, a weeks-old leftover can carry the same name as a live session.
    if (!isStatus(raw.status) || typeof raw.pid !== 'number' || !raw.sessionId || !raw.cwd) {
      return undefined;
    }
    // pids only mean something inside their own domain.
    if (raw.pidDomain && raw.pidDomain !== process.platform) {
      return undefined;
    }
    if (!isPidAlive(raw.pid) || !socketLooksLive(raw.messagingSocketPath)) {
      return undefined;
    }

    const statusUpdatedAt = raw.statusUpdatedAt ?? raw.updatedAt ?? raw.startedAt ?? now;
    return {
      pid: raw.pid,
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      name: raw.name || path.basename(raw.cwd),
      status: raw.status,
      waitingFor: raw.waitingFor,
      needs: raw.needs,
      startedAt: raw.startedAt ?? statusUpdatedAt,
      statusUpdatedAt,
      version: raw.version,
      kind: raw.kind,
      entrypoint: raw.entrypoint,
      stuck: raw.status === 'busy' && now - statusUpdatedAt > stuckAfterMs,
    };
  }

  private publish(sessions: Session[]): void {
    const signature = JSON.stringify([
      this._error ?? '',
      sessions.map((s) => [s.pid, s.sessionId, s.status, s.stuck, s.name, s.waitingFor ?? '']),
    ]);
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this._sessions = sessions;
    this._onDidChange.fire();
  }

  private attachWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;

    const dir = sessionsDir();
    this.watchedDir = dir;
    try {
      this.watcher = fs.watch(dir, { persistent: false }, () => this.scheduleRefresh());
      this.watcher.on('error', (err) => this.log.appendLine(`watch error: ${String(err)}`));
    } catch (err) {
      // No directory yet. The poll still runs, and will pick it up once created.
      this.log.appendLine(`could not watch ${dir}, falling back to polling: ${String(err)}`);
    }
  }

  private scheduleRefresh(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      this.refresh();
    }, 150);
  }

  private restartPoll(): void {
    if (this.poll) {
      clearInterval(this.poll);
    }
    const interval = Math.max(
      1000,
      vscode.workspace.getConfiguration(CONFIG).get<number>('pollIntervalMs') ?? 5000
    );
    this.poll = setInterval(() => this.refresh(), interval);
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    if (this.poll) {
      clearInterval(this.poll);
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this._onDidChange.dispose();
  }
}
