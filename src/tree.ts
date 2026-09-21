import * as path from 'path';
import * as vscode from 'vscode';

import { SessionStore } from './sessionStore';
import { readTail } from './transcript';
import { GROUP_LABEL, Session, SessionStatus, STATUS_ORDER } from './types';

const CONFIG = 'claudeSessionMonitor';

export class GroupNode {
  constructor(readonly status: SessionStatus, readonly count: number) {}
}

export class SessionNode {
  constructor(readonly session: Session) {}
}

export class MessageNode {
  constructor(readonly text: string) {}
}

export type Node = GroupNode | SessionNode | MessageNode;

function relativeAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

function icon(session: Session): vscode.ThemeIcon {
  if (session.status === 'waiting') {
    return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.red'));
  }
  if (session.status === 'busy') {
    return session.stuck
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'))
      : new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
  }
  return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
}

function inWorkspace(cwd: string): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (folder) => cwd === folder.uri.fsPath || cwd.startsWith(folder.uri.fsPath + path.sep)
  );
}

export class SessionTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: SessionStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: Node): Node[] {
    if (element instanceof SessionNode || element instanceof MessageNode) {
      return [];
    }

    if (element instanceof GroupNode) {
      return this.store.byStatus(element.status).map((s) => new SessionNode(s));
    }

    if (this.store.error) {
      return [new MessageNode(this.store.error)];
    }

    const config = vscode.workspace.getConfiguration(CONFIG);
    const showIdle = config.get<boolean>('showIdle') ?? true;
    const hideEmpty = config.get<boolean>('hideEmptyGroups') ?? false;

    if (this.store.sessions.length === 0) {
      return [new MessageNode('No Claude sessions running.')];
    }

    return STATUS_ORDER.filter((status) => status !== 'idle' || showIdle)
      .map((status) => new GroupNode(status, this.store.byStatus(status).length))
      .filter((group) => !hideEmpty || group.count > 0);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element instanceof MessageNode) {
      const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'claudeMessage';
      return item;
    }

    if (element instanceof GroupNode) {
      const item = new vscode.TreeItem(
        `${GROUP_LABEL[element.status]} (${element.count})`,
        element.count > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      item.contextValue = `claudeGroup.${element.status}`;
      return item;
    }

    const session = element.session;

    // Prefer what the session is actually about. The derived name
    // ("my-project-4f") is meaningless on its own but is what the chat tab is
    // called, so it moves to the description where it still lines up visually.
    const title = readTail(session.cwd, session.sessionId).title;
    const item = new vscode.TreeItem(title ?? session.name, vscode.TreeItemCollapsibleState.None);
    item.id = `${session.pid}:${session.sessionId}`;
    item.iconPath = icon(session);
    item.contextValue = `claudeSession.${session.status}`;

    const age = relativeAge(session.statusUpdatedAt);
    const detail = session.status === 'waiting' ? session.waitingFor ?? 'waiting' : age;
    const parts = title ? [session.name, detail] : [detail];
    // The scope is machine-wide, so spell out where a session lives when it is
    // not part of this window's workspace.
    if (!inWorkspace(session.cwd)) {
      parts.unshift(session.cwd);
    }
    item.description = parts.join(' · ');

    item.command = {
      command: 'claudeSessionMonitor.reveal',
      title: 'Go to Chat',
      arguments: [element],
    };
    return item;
  }

  /** Tooltips read the transcript, so they are resolved lazily rather than eagerly. */
  resolveTreeItem(item: vscode.TreeItem, element: Node): vscode.TreeItem {
    if (!(element instanceof SessionNode)) {
      return item;
    }
    const session = element.session;
    const tail = readTail(session.cwd, session.sessionId);

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${tail.title ?? session.name}**\n\n`);
    if (session.status === 'waiting') {
      md.appendMarkdown(`Waiting on you: _${session.waitingFor ?? 'input needed'}_`);
      if (session.needs) {
        md.appendMarkdown(` (${session.needs})`);
      }
      md.appendMarkdown('\n\n');
    } else if (session.stuck) {
      md.appendMarkdown(`Busy with no status change for ${relativeAge(session.statusUpdatedAt)}.\n\n`);
    } else {
      md.appendMarkdown(`${session.status} for ${relativeAge(session.statusUpdatedAt)}\n\n`);
    }
    if (tail.lastPrompt) {
      const prompt = tail.lastPrompt.replace(/\s+/g, ' ').slice(0, 300);
      md.appendMarkdown(`Last prompt: ${prompt}${tail.lastPrompt.length > 300 ? '…' : ''}\n\n`);
    }
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`\`${session.cwd}\`\n\n`);
    md.appendMarkdown(
      `tab \`${session.name}\` · pid ${session.pid} · started ${relativeAge(session.startedAt)} ago` +
        (session.version ? ` · v${session.version}` : '') +
        `\n\n\`${session.sessionId}\``
    );

    item.tooltip = md;
    return item;
  }
}
