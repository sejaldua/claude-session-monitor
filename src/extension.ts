import * as vscode from 'vscode';

import { debugTabs, openTranscript, revealSession } from './reveal';
import { SessionStore } from './sessionStore';
import { WaitingStatusBar } from './statusBar';
import { Node, SessionNode, SessionTreeProvider } from './tree';

const CONFIG = 'claudeSessionMonitor';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Claude Session Monitor');
  const store = new SessionStore(log);
  const tree = new SessionTreeProvider(store);
  const statusBar = new WaitingStatusBar(store);

  const view = vscode.window.createTreeView('claudeSessionMonitor.sessions', {
    treeDataProvider: tree,
  });

  const render = () => {
    tree.refresh();
    statusBar.update();
    const waiting = store.byStatus('waiting').length;
    view.badge = waiting > 0 ? { value: waiting, tooltip: `${waiting} waiting on you` } : undefined;
  };

  const sessionOf = (node?: Node) => (node instanceof SessionNode ? node.session : undefined);

  context.subscriptions.push(
    log,
    store,
    statusBar,
    view,
    store.onDidChange(render),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG)) {
        store.reconfigure();
        render();
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.refresh`, () => {
      store.refresh();
      render();
    }),
    vscode.commands.registerCommand(`${CONFIG}.focusView`, () =>
      vscode.commands.executeCommand('claudeSessionMonitor.sessions.focus')
    ),
    vscode.commands.registerCommand(`${CONFIG}.reveal`, async (node?: Node) => {
      const session = sessionOf(node);
      if (session) {
        await revealSession(session);
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.revealFirstWaiting`, async () => {
      const [first] = store.byStatus('waiting');
      if (first) {
        await revealSession(first);
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.openTranscript`, async (node?: Node) => {
      const session = sessionOf(node);
      if (session) {
        await openTranscript(session);
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.copySessionId`, async (node?: Node) => {
      const session = sessionOf(node);
      if (session) {
        await vscode.env.clipboard.writeText(session.sessionId);
        void vscode.window.showInformationMessage(`Copied ${session.sessionId}`);
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.debugTabs`, () => debugTabs(log, store.sessions))
  );

  store.start();
  render();
}

export function deactivate(): void {
  // Everything is registered in context.subscriptions.
}
