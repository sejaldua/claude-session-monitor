import * as fs from 'fs';

/**
 * A pid we can signal is alive. EPERM means the process exists but belongs to
 * someone else, which still counts; only ESRCH means it is gone.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Claude Code opens a unix socket per live session. An absent socket alongside a
 * live pid means the pid got recycled onto something else. A record with no
 * socket path at all is not penalised, since that field is not guaranteed.
 */
export function socketLooksLive(socketPath: string | undefined): boolean {
  if (!socketPath) {
    return true;
  }
  try {
    fs.statSync(socketPath);
    return true;
  } catch {
    return false;
  }
}
