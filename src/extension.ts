import * as vscode from 'vscode';

import { SAMPLE_MS, StateHistory } from './history';
import { WaitingNotifier } from './notify';
import { ROW_STYLES, RowStyle, SessionPanel } from './panelView';
import { debugTabs, openTranscript, revealSession } from './reveal';
import { SessionStore } from './sessionStore';
import { WaitingStatusBar } from './statusBar';

const CONFIG = 'claudeSessionMonitor';

const STYLE_BLURB: Record<RowStyle, string> = {
  rail: 'One sorted list, state as a stripe on the edge',
  duration: 'Bars showing how long each session has held its state',
  ledger: 'Aligned columns, densest at many sessions',
  pulse: 'A sparkline of what each session has been doing',
};

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Claude Session Monitor');
  const store = new SessionStore(log);
  const history = new StateHistory();
  const statusBar = new WaitingStatusBar(store);
  const notifier = new WaitingNotifier(store, revealSession);

  const panel = new SessionPanel(
    context.extensionUri,
    store,
    history,
    revealSession,
    openTranscript
  );

  const render = () => {
    panel.render();
    statusBar.update();
    notifier.update();
  };

  // Sampling on a fixed interval keeps every sparkline slot the same width,
  // and doubles as the tick that keeps elapsed times honest between changes.
  const tick = setInterval(() => {
    history.record(store.sessions);
    render();
  }, SAMPLE_MS);

  context.subscriptions.push(
    log,
    store,
    statusBar,
    vscode.window.registerWebviewViewProvider(SessionPanel.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    new vscode.Disposable(() => clearInterval(tick)),
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
      vscode.commands.executeCommand(`${SessionPanel.viewType}.focus`)
    ),
    vscode.commands.registerCommand(`${CONFIG}.revealFirstWaiting`, async () => {
      const [first] = store.byStatus('waiting');
      if (first) {
        await revealSession(first);
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.chooseLayout`, () => chooseLayout()),
    vscode.commands.registerCommand(`${CONFIG}.toggleHeadline`, async () => {
      const config = vscode.workspace.getConfiguration(CONFIG);
      const next = !(config.get<boolean>('showHeadline') ?? true);
      await config.update('showHeadline', next, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand(`${CONFIG}.debugTabs`, () => debugTabs(log, store.sessions))
  );

  store.start();
  history.record(store.sessions);
  render();
}

async function chooseLayout(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG);
  const current = config.get<string>('rowStyle') ?? 'rail';

  const picked = await vscode.window.showQuickPick(
    ROW_STYLES.map((style) => ({
      label: style.charAt(0).toUpperCase() + style.slice(1),
      description: style === current ? 'current' : undefined,
      detail: STYLE_BLURB[style],
      style,
    })),
    { title: 'Session row style', placeHolder: 'How rows are drawn' }
  );

  if (picked) {
    await config.update('rowStyle', picked.style, vscode.ConfigurationTarget.Global);
  }
}

export function deactivate(): void {
  // Everything is registered in context.subscriptions.
}
