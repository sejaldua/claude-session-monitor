import * as path from 'path';
import * as vscode from 'vscode';

import { relativeAge } from './format';
import { SLOTS, Sample, StateHistory } from './history';
import { SessionStore } from './sessionStore';
import { readTail } from './transcript';
import { Session } from './types';

const CONFIG = 'claudeSessionMonitor';

export type RowStyle = 'rail' | 'duration' | 'ledger' | 'pulse';
export const ROW_STYLES: RowStyle[] = ['rail', 'duration', 'ledger', 'pulse'];

export interface RowModel {
  id: string;
  title: string;
  name: string;
  project: string;
  status: string;
  stuck: boolean;
  waitingFor: string;
  age: string;
  /** 0 to 1, log-scaled, for the duration bars. */
  weight: number;
  spark: Sample[];
}

/**
 * The panel as a webview.
 *
 * A TreeItem gives you an icon, a label, a dim description and a decoration
 * colour, which is not enough for bars, columns, cards or sparklines. The cost
 * is that keyboard handling and the context menu are ours to build; theming is
 * not, since VS Code exposes every theme colour to a webview as a
 * `--vscode-*` custom property, contributed colours included.
 */
export class SessionPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeSessionMonitor.panel';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: SessionStore,
    private readonly history: StateHistory,
    private readonly onReveal: (session: Session) => Promise<void>,
    private readonly onTranscript: (session: Session) => Promise<void>
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((message: { type: string; id?: string }) => {
      const session = this.store.sessions.find((s) => s.sessionId === message.id);
      if (message.type === 'reveal' && session) {
        void this.onReveal(session);
      } else if (message.type === 'transcript' && session) {
        void this.onTranscript(session);
      } else if (message.type === 'copyId' && session) {
        void vscode.env.clipboard.writeText(session.sessionId);
        void vscode.window.showInformationMessage(`Copied ${session.sessionId}`);
      } else if (message.type === 'ready') {
        this.render();
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.render();
      }
    });

    this.render();
  }

  render(): void {
    if (!this.view) {
      return;
    }

    const config = vscode.workspace.getConfiguration(CONFIG);
    const sessions = this.store.sessions;
    const waiting = sessions.filter((s) => s.status === 'waiting');

    this.view.badge =
      waiting.length > 0
        ? { value: waiting.length, tooltip: `${waiting.length} waiting on you` }
        : undefined;

    void this.view.webview.postMessage({
      type: 'render',
      error: this.store.error,
      headline: config.get<boolean>('showHeadline') ?? true,
      rowStyle: config.get<string>('rowStyle') ?? 'rail',
      showIdle: config.get<boolean>('showIdle') ?? true,
      rows: sessions.map((s) => this.toRow(s, sessions)),
    });
  }

  private toRow(session: Session, all: Session[]): RowModel {
    // Log scale, because one panel has to hold two seconds and three hours.
    const oldest = Math.max(...all.map((s) => Date.now() - s.statusUpdatedAt), 1);
    const age = Math.max(Date.now() - session.statusUpdatedAt, 0);
    const weight = Math.log1p(age / 1000) / Math.log1p(oldest / 1000);

    return {
      id: session.sessionId,
      title: readTail(session.cwd, session.sessionId).title ?? session.name,
      name: session.name,
      project: path.basename(session.cwd),
      status: session.status,
      stuck: session.stuck,
      waitingFor: session.waitingFor ?? 'input needed',
      age: relativeAge(session.statusUpdatedAt),
      weight: Number.isFinite(weight) ? Math.min(1, Math.max(0.02, weight)) : 0.02,
      spark: this.history.get(session),
    };
  }

  private html(webview: vscode.Webview): string {
    const asset = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = Array.from({ length: 32 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
        Math.floor(Math.random() * 62)
      )
    ).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${asset('panel.css')}" rel="stylesheet">
<title>Claude Sessions</title>
</head>
<body data-slots="${SLOTS}">
<div id="root" role="list" aria-label="Claude sessions"></div>
<div id="menu" class="menu" hidden role="menu"></div>
<script nonce="${nonce}" src="${asset('panel.js')}"></script>
</body>
</html>`;
  }
}
