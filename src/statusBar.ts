import * as vscode from 'vscode';

import { relativeAge } from './format';
import { SessionStore } from './sessionStore';

const CONFIG = 'claudeSessionMonitor';

/**
 * Visible only when something is blocked on you, and increasingly insistent the
 * longer it stays that way: amber at first, red once the oldest block passes
 * the escalation threshold. The elapsed time is the useful part, since a
 * session that has been waiting twenty minutes is a different problem from one
 * that just stopped.
 */
export class WaitingStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private pulse: NodeJS.Timeout | undefined;
  private pulseOn = false;

  constructor(private readonly store: SessionStore) {
    this.item = vscode.window.createStatusBarItem(
      'claudeSessionMonitor.waiting',
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.name = 'Claude Sessions';
  }

  update(): void {
    const waiting = this.store.byStatus('waiting');
    if (waiting.length === 0) {
      this.stopPulse();
      this.item.hide();
      return;
    }

    const config = vscode.workspace.getConfiguration(CONFIG);
    const oldest = Math.min(...waiting.map((s) => s.statusUpdatedAt));
    const escalateAfterMs = (config.get<number>('escalateAfterMinutes') ?? 2) * 60_000;
    const escalated = Date.now() - oldest >= escalateAfterMs;

    this.item.backgroundColor = new vscode.ThemeColor(
      escalated ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground'
    );

    const icon = this.pulseOn ? 'bell' : 'bell-dot';
    const plural = waiting.length === 1 ? 'needs' : 'need';
    this.item.text = `$(${icon}) ${waiting.length} ${plural} you · ${relativeAge(oldest)}`;

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Blocked on you**\n\n`);
    for (const session of waiting) {
      tooltip.appendMarkdown(
        `- ${session.name} · ${session.waitingFor ?? 'input needed'} · ${relativeAge(
          session.statusUpdatedAt
        )}\n`
      );
    }
    this.item.tooltip = tooltip;

    // One blocked session means there is no choice to present, so go straight
    // there rather than opening a list of one.
    this.item.command =
      waiting.length === 1
        ? `${CONFIG}.revealFirstWaiting`
        : `${CONFIG}.focusView`;

    this.item.show();
    this.syncPulse(config.get<boolean>('statusBarPulse') ?? false);
  }

  private syncPulse(enabled: boolean): void {
    if (!enabled) {
      this.stopPulse();
      return;
    }
    if (this.pulse) {
      return;
    }
    this.pulse = setInterval(() => {
      this.pulseOn = !this.pulseOn;
      this.update();
    }, 1200);
  }

  private stopPulse(): void {
    if (this.pulse) {
      clearInterval(this.pulse);
      this.pulse = undefined;
    }
    this.pulseOn = false;
  }

  dispose(): void {
    this.stopPulse();
    this.item.dispose();
  }
}
