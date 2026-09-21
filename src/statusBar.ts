import * as vscode from 'vscode';

import { SessionStore } from './sessionStore';

/**
 * Visible only when something is blocked on you. With one waiting session the
 * click goes straight to that chat; with several it opens the panel.
 */
export class WaitingStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly store: SessionStore) {
    this.item = vscode.window.createStatusBarItem('claudeSessionMonitor.waiting', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Claude Sessions';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  update(): void {
    const waiting = this.store.byStatus('waiting');
    if (waiting.length === 0) {
      this.item.hide();
      return;
    }

    this.item.text = `$(bell-dot) ${waiting.length} need${waiting.length === 1 ? 's' : ''} you`;
    if (waiting.length === 1) {
      const session = waiting[0];
      this.item.tooltip = `${session.name}: ${session.waitingFor ?? 'input needed'}`;
      this.item.command = 'claudeSessionMonitor.revealFirstWaiting';
    } else {
      this.item.tooltip = waiting
        .map((s) => `${s.name}: ${s.waitingFor ?? 'input needed'}`)
        .join('\n');
      this.item.command = 'claudeSessionMonitor.focusView';
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
