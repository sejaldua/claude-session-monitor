import * as vscode from 'vscode';

import { SessionStore } from './sessionStore';
import { readTail } from './transcript';
import { Session } from './types';

const CONFIG = 'claudeSessionMonitor';

/**
 * Announces a session the moment it becomes blocked.
 *
 * Only transitions are announced, never the standing set, so a session that has
 * been waiting for an hour does not re-nag on every poll. The first update
 * after activation primes the set silently: reloading the window should not
 * produce a toast for every session that was already waiting.
 */
export class WaitingNotifier {
  private announced = new Set<string>();
  private primed = false;

  constructor(
    private readonly store: SessionStore,
    private readonly reveal: (session: Session) => Promise<void>
  ) {}

  update(): void {
    const waiting = this.store.byStatus('waiting');
    const current = new Set(waiting.map((s) => s.sessionId));

    if (!this.primed) {
      this.primed = true;
      this.announced = current;
      return;
    }

    if (vscode.workspace.getConfiguration(CONFIG).get<boolean>('notifyWhenWaiting') ?? true) {
      for (const session of waiting) {
        if (!this.announced.has(session.sessionId)) {
          void this.announce(session);
        }
      }
    }

    this.announced = current;
  }

  private async announce(session: Session): Promise<void> {
    const title = readTail(session.cwd, session.sessionId).title ?? session.name;
    const reason = session.waitingFor ?? 'input needed';
    const choice = await vscode.window.showWarningMessage(
      `${title} needs you: ${reason}`,
      'Go to chat',
      'Mute these'
    );

    if (choice === 'Go to chat') {
      await this.reveal(session);
    } else if (choice === 'Mute these') {
      await vscode.workspace
        .getConfiguration(CONFIG)
        .update('notifyWhenWaiting', false, vscode.ConfigurationTarget.Global);
    }
  }
}
