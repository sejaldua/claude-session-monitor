import * as vscode from 'vscode';

import { Session } from './types';

export const SESSION_SCHEME = 'claude-session';

type Kind = 'waiting' | 'stuck' | 'busy' | 'idle';

function kindOf(session: Session): Kind {
  if (session.status === 'waiting') {
    return 'waiting';
  }
  if (session.status === 'busy') {
    return session.stuck ? 'stuck' : 'busy';
  }
  return 'idle';
}

/**
 * The URI is the carrier for a row's state. Encoding the kind into the path
 * means a session that changes state gets a different URI, so VS Code asks for
 * a fresh decoration instead of reusing the cached one.
 */
export function sessionUri(session: Session): vscode.Uri {
  return vscode.Uri.parse(`${SESSION_SCHEME}:/${kindOf(session)}/${session.pid}`);
}

/**
 * Colours the row label itself.
 *
 * A tree item's iconPath can be tinted, but the label always renders in the
 * default foreground. A FileDecorationProvider is the only way to colour the
 * text, and it is what git uses to grey out ignored files. The badge is the
 * short marker at the right edge of the row.
 */
export class SessionDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SESSION_SCHEME) {
      return undefined;
    }
    switch (uri.path.split('/')[1] as Kind) {
      case 'waiting':
        return decoration('!', 'Waiting on you', 'claudeSessionMonitor.waiting');
      case 'stuck':
        return decoration('?', 'Busy, but nothing has changed in a while', 'claudeSessionMonitor.stuck');
      case 'busy':
        return decoration('', 'Working', 'claudeSessionMonitor.busy');
      case 'idle':
        return decoration('', 'Idle', 'claudeSessionMonitor.idle');
      default:
        return undefined;
    }
  }

  /** Re-ask for every decoration. Cheap, and keeps colours honest after a poll. */
  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function decoration(badge: string, tooltip: string, color: string): vscode.FileDecoration {
  const result = new vscode.FileDecoration(
    badge || undefined,
    tooltip,
    new vscode.ThemeColor(color)
  );
  result.propagate = false;
  return result;
}
