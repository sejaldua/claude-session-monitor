# Changelog

## 0.2.0

- Colour row labels by state through a `FileDecorationProvider`, with a badge
  on blocked and stuck rows. Tinting a tree item's icon is possible; colouring
  its label is not, which is why this needs a decoration provider.
- Contribute four themeable colours: `claudeSessionMonitor.waiting`, `.stuck`,
  `.busy`, `.idle`.
- Status bar now shows how long the oldest blocked session has waited, and
  escalates from amber to red past `escalateAfterMinutes`.
- Optional blinking bell via `statusBarPulse`.
- Notify when a session newly blocks, with "Go to chat" and "Mute these"
  actions. Transitions only, and the first scan after activation primes
  silently so a window reload does not produce a burst of toasts.
- Rewrote the README for a general audience.

## 0.1.4

- Collapse rows that describe the same chat. One chat can be served by several
  live processes, each with its own status file, which put the same chat in two
  groups at once. The row that most needs attention wins.
- Click-through opens the chat in the Claude Code sidebar. Claude routes a
  session to the sidebar only when its stored preferred location is already
  `sidebar`, so the extension sets that first via `claude-vscode.sidebar.open`.
- New `claudeSessionMonitor.openLocation` setting, `sidebar` or `panel`.
- Sidebar mode skips tab matching, so a leftover tab from an earlier panel open
  no longer wins over the sidebar.

## 0.1.3

- Focus an existing chat tab before asking Claude to open a session, which was
  creating a new tab whenever the chat was absent from Claude's panel registry.
- Match tabs by AI title first, then derived name.
- Compare the focused tab by label rather than object identity. VS Code hands
  out fresh `Tab` objects as groups change, so a successful focus could report
  failure and fall through to the transcript.

## 0.1.2

- Click-through uses `claude-vscode.editor.open` with the session id instead of
  matching tab labels.

## 0.1.1

- Label rows with the session's AI title instead of its derived name, and move
  the derived name into the description.
- Add `.vscodeignore`.

## 0.1.0

- Initial version: tree view grouped by session state, waiting-only status bar
  item, stuck detection, transcript tooltips.
