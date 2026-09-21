import * as vscode from 'vscode';

import { readTail, transcriptPath } from './transcript';
import { Session } from './types';

const CHAT_VIEW_TYPE = 'claudeVSCodePanel';

const GROUP_FOCUS_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

interface TabLocation {
  tab: vscode.Tab;
  groupIndex: number;
  tabIndex: number;
}

function isChatTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  return input instanceof vscode.TabInputWebview && input.viewType.includes(CHAT_VIEW_TYPE);
}

/** Every Claude chat tab in this window, with the coordinates needed to focus it. */
export function chatTabs(): TabLocation[] {
  const found: TabLocation[] = [];
  vscode.window.tabGroups.all.forEach((group, groupIndex) => {
    group.tabs.forEach((tab, tabIndex) => {
      if (isChatTab(tab)) {
        found.push({ tab, groupIndex, tabIndex });
      }
    });
  });
  return found;
}

/**
 * Match a session to its tab.
 *
 * The tab label is the session's AI title. Claude's own logs show the webview
 * reporting `update_session_state` with `{sessionId, state, title}`, and that
 * title is what the tab is named. The derived name ("my-project-4f") is tried
 * second for a session with no title yet.
 */
function findTab(session: Session): TabLocation | undefined {
  const tabs = chatTabs();
  const title = readTail(session.cwd, session.sessionId).title;
  const byTitle = title ? tabs.find((t) => t.tab.label === title) : undefined;
  return byTitle ?? tabs.find((t) => t.tab.label === session.name);
}

async function focusGroup(groupIndex: number): Promise<void> {
  const active = vscode.window.tabGroups.activeTabGroup;
  if (vscode.window.tabGroups.all.indexOf(active) === groupIndex) {
    return;
  }
  const command = GROUP_FOCUS_COMMANDS[groupIndex];
  if (command) {
    await vscode.commands.executeCommand(command);
    return;
  }
  // Beyond the eighth group there is no ordinal command, so walk to it.
  await vscode.commands.executeCommand(GROUP_FOCUS_COMMANDS[0]);
  for (let i = 0; i < groupIndex; i++) {
    await vscode.commands.executeCommand('workbench.action.focusNextGroup');
  }
}

/**
 * There is no tab.show() in the API and no Claude command that takes a session
 * id, so focusing means: focus the group, then open the editor at that index.
 * The generic openEditorAtIndex is 0-based; the numbered variants are 1-based
 * and serve as a fallback if the generic one does not land.
 */
async function focusTab(location: TabLocation): Promise<boolean> {
  await focusGroup(location.groupIndex);

  await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', location.tabIndex);
  if (landedOn(location)) {
    return true;
  }

  if (location.tabIndex < 9) {
    await vscode.commands.executeCommand(`workbench.action.openEditorAtIndex${location.tabIndex + 1}`);
  }
  return landedOn(location);
}

/**
 * Compare by label rather than by object identity. VS Code hands out fresh Tab
 * objects as groups change, so an identity check reports failure for a tab that
 * is in fact now active.
 */
function landedOn(location: TabLocation): boolean {
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  return active !== undefined && active.label === location.tab.label && isChatTab(active);
}

export async function openTranscript(session: Session): Promise<void> {
  const file = transcriptPath(session.cwd, session.sessionId);
  if (!file) {
    void vscode.window.showWarningMessage(
      `No transcript found on disk for ${session.name} (${session.sessionId}).`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: true });
}

const OPEN_COMMAND = 'claude-vscode.editor.open';
const SIDEBAR_COMMAND = 'claude-vscode.sidebar.open';

type OpenLocation = 'sidebar' | 'panel';

function openLocation(): OpenLocation {
  const value = vscode.workspace
    .getConfiguration('claudeSessionMonitor')
    .get<string>('openLocation');
  return value === 'panel' ? 'panel' : 'sidebar';
}

async function hasOpenCommand(): Promise<boolean> {
  return (await vscode.commands.getCommands(true)).includes(OPEN_COMMAND);
}

/**
 * Ask Claude Code itself to surface the session.
 *
 * The command's first argument is a session id; the rest mirror what Claude's
 * own sessions list sends when a row is clicked: (sessionId, initialPrompt,
 * viewColumn, newSessionGroupId, fullEditor, opts).
 *
 * Routing is the fiddly part. Claude sends a session to the sidebar only when
 * `programmatic` is "honor-preferred-location" AND its stored preferred
 * location is already "sidebar" AND the session is not open in a panel. Any
 * other combination lands in a new editor tab. Since nothing exposes that
 * stored preference, we set it first: `claude-vscode.sidebar.open` calls
 * setPreferredLocation("sidebar") and focuses the view, which also guarantees
 * the sidebar webview exists to receive the activation we are about to send.
 */
async function openViaClaude(sessionId: string): Promise<boolean> {
  if (!(await hasOpenCommand())) {
    return false;
  }
  const location = openLocation();
  try {
    if (location === 'sidebar') {
      await vscode.commands.executeCommand(SIDEBAR_COMMAND);
    }
    await vscode.commands.executeCommand(
      OPEN_COMMAND,
      sessionId,
      undefined,
      undefined,
      undefined,
      true,
      { programmatic: location === 'sidebar' ? 'honor-preferred-location' : 'pin-to-panel' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Go to the live chat. This extension never opens a terminal, so the transcript
 * is the last resort rather than an alternative.
 */
export async function revealSession(session: Session): Promise<void> {
  // In panel mode, focusing an existing tab beats asking Claude to open the
  // session, which creates a new tab whenever the chat is not in its panel
  // registry. In sidebar mode we skip straight past tabs: a stray tab left over
  // from an earlier panel open is not where the user does their work.
  if (openLocation() === 'panel' && (await focusExistingTab(session))) {
    return;
  }

  if (await openViaClaude(session.sessionId)) {
    await focusChatInput();
    return;
  }

  if (await focusExistingTab(session)) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Could not open the chat for ${session.name} (${session.cwd}).`,
    'Open Transcript'
  );
  if (choice === 'Open Transcript') {
    await openTranscript(session);
  }
}

async function focusExistingTab(session: Session): Promise<boolean> {
  const location = findTab(session);
  if (location && (await focusTab(location))) {
    await focusChatInput();
    return true;
  }
  return false;
}

async function focusChatInput(): Promise<void> {
  try {
    await vscode.commands.executeCommand('claude-vscode.focus');
  } catch {
    /* The chat is already up; putting the cursor in its input is a nicety. */
  }
}

/** Dumps tab labels next to session names so the matching above can be checked. */
export async function debugTabs(log: vscode.OutputChannel, sessions: Session[]): Promise<void> {
  log.appendLine(`--- ${OPEN_COMMAND} available: ${await hasOpenCommand()} ---`);
  log.appendLine('--- tabs in this window ---');
  vscode.window.tabGroups.all.forEach((group, groupIndex) => {
    group.tabs.forEach((tab, tabIndex) => {
      const input = tab.input;
      const kind =
        input instanceof vscode.TabInputWebview
          ? `webview:${input.viewType}`
          : input?.constructor?.name ?? 'unknown';
      log.appendLine(`  [${groupIndex}:${tabIndex}] ${JSON.stringify(tab.label)}  ${kind}`);
    });
  });
  log.appendLine('--- live sessions ---');
  for (const s of sessions) {
    log.appendLine(
      `  ${JSON.stringify(s.name)}  status=${s.status} pid=${s.pid} cwd=${s.cwd} matched=${Boolean(
        findTab(s)
      )}`
    );
  }
  log.show(true);
}
