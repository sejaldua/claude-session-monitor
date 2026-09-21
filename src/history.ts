import { Session } from './types';

/** One sample of what a session was doing. 'gone' pads the time before we saw it. */
export type Sample = 'waiting' | 'busy' | 'stuck' | 'idle' | 'gone';

/** 20 slots at one sample every 30s covers the last ten minutes. */
export const SLOTS = 20;
export const SAMPLE_MS = 30_000;

function sampleOf(session: Session): Sample {
  if (session.status === 'waiting') {
    return 'waiting';
  }
  if (session.status === 'busy') {
    return session.stuck ? 'stuck' : 'busy';
  }
  return 'idle';
}

/**
 * A short in-memory trace of what each session has been doing.
 *
 * Sampled on a fixed interval rather than on status change, so every slot
 * covers the same span of time and the sparkline is a real time axis instead
 * of a list of transitions. Nothing is written to disk; a reload starts over.
 */
export class StateHistory {
  private readonly buffers = new Map<string, Sample[]>();

  record(sessions: Session[]): void {
    const live = new Set<string>();

    for (const session of sessions) {
      live.add(session.sessionId);
      const buffer = this.buffers.get(session.sessionId) ?? new Array<Sample>(SLOTS).fill('gone');
      buffer.push(sampleOf(session));
      while (buffer.length > SLOTS) {
        buffer.shift();
      }
      this.buffers.set(session.sessionId, buffer);
    }

    for (const id of [...this.buffers.keys()]) {
      if (!live.has(id)) {
        this.buffers.delete(id);
      }
    }
  }

  /**
   * The trace, with the current state written into the last slot. Without that
   * the sparkline lags the row beside it by up to a full sample interval.
   */
  get(session: Session): Sample[] {
    const buffer = this.buffers.get(session.sessionId);
    const trace = buffer ? [...buffer] : new Array<Sample>(SLOTS).fill('gone');
    trace[trace.length - 1] = sampleOf(session);
    return trace;
  }
}
