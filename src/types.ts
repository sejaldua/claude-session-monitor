export type SessionStatus = 'waiting' | 'busy' | 'idle';

/** Shape of ~/.claude/sessions/<pid>.json. Internal to Claude Code, so every field is optional. */
export interface RawSessionFile {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  name?: string;
  nameSource?: string;
  status?: string;
  waitingFor?: string;
  needs?: string;
  startedAt?: number;
  updatedAt?: number;
  statusUpdatedAt?: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
  pidDomain?: string;
  messagingSocketPath?: string;
}

export interface Session {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  status: SessionStatus;
  waitingFor?: string;
  needs?: string;
  startedAt: number;
  statusUpdatedAt: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
  /** Busy for longer than the configured threshold with no status change. */
  stuck: boolean;
}

export const STATUS_ORDER: SessionStatus[] = ['waiting', 'busy', 'idle'];

export const GROUP_LABEL: Record<SessionStatus, string> = {
  waiting: 'Needs you',
  busy: 'Working',
  idle: 'Idle',
};
