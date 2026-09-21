# Claude Session Monitor

A VS Code sidebar that sorts every running Claude Code session into **Needs
you**, **Working**, and **Idle**.

If you keep several Claude Code chats going at once, VS Code gives you a row of
identical-looking tabs and no indication of which one is blocked on a permission
prompt. This extension makes that visible, and clicking a row takes you to the
chat.

```
Needs you (1)
  🔴 Refactor auth middleware          my-project-4f · permission prompt
Working (1)
  🔄 Investigate flaky integration test my-project-c8 · 2s
Idle (2)
  ⚪ Port the CLI to async              my-project-ae · 18m
  ⚪ Document the release process       other-repo-52 · 2h 44m
```

## Requirements

- VS Code 1.90 or later
- The Claude Code extension (`anthropic.claude-code`), for click-through. The
  list itself works without it.

## Install

No marketplace release. Build and install from source:

```sh
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension claude-session-monitor-*.vsix
```

Then reload the window. For development, F5 launches an Extension Development
Host instead.

## What it does

- **Sidebar** grouped by state, covering every Claude session on the machine,
  not just the open workspace. Rows are labelled with the session's topic, taken
  from the `ai-title` record in its transcript. The derived name that matches
  the chat tab sits in the description, alongside how long the session has been
  in its current state. The working directory is shown for sessions outside the
  current workspace.
- **Status bar** that appears only when something needs you, reading
  `🔔 2 need you` in the warning colour. With exactly one waiting session, the
  click goes straight to it.
- **Click a row** to go to that live chat with the cursor in its input.
- **Possibly stuck** detection: a session busy with no status change for 15
  minutes (configurable) gets a warning icon inside Working.
- **Tooltips** with the AI title, last prompt, the reason a session is waiting,
  working directory, pid, and session id.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `claudeSessionMonitor.openLocation` | `sidebar` | Where clicking a session takes you: the Claude Code sidebar, or an editor tab. |
| `claudeSessionMonitor.pollIntervalMs` | `5000` | Re-scan interval. |
| `claudeSessionMonitor.stuckAfterMinutes` | `15` | Busy-with-no-change threshold for the stuck warning. |
| `claudeSessionMonitor.showIdle` | `true` | Show the Idle group. |
| `claudeSessionMonitor.hideEmptyGroups` | `false` | Hide empty groups. Off so the layout does not jump. |
| `claudeSessionMonitor.claudeHome` | `""` | Override the Claude home directory. Empty means `~/.claude`. |

## How it works

Everything here depends on files Claude Code writes locally. None of it is
public API, so see [Limitations](#limitations).

### Session state

Claude Code writes one small status file per live process at
`~/.claude/sessions/<pid>.json`, rewritten on every status change:

```json
{
  "pid": 12345,
  "sessionId": "00000000-0000-0000-0000-000000000000",
  "cwd": "/Users/you/code/my-project",
  "name": "my-project-4f",
  "status": "waiting",
  "waitingFor": "input needed",
  "messagingSocketPath": "/tmp/cc-socks/12345.sock",
  "startedAt": 1700000000000,
  "statusUpdatedAt": 1700000000000
}
```

`status` is a three-value enum, `busy | idle | waiting`, which maps directly
onto the three groups. `waitingFor` explains the block; the values in the
binary are `input needed`, `dialog open`, `goal proposal`, `sandbox request`,
and a default of `permission prompt`.

### Why not parse the transcripts

The obvious approach is to read the conversation transcripts under
`~/.claude/projects/**/*.jsonl` and infer state. It does not work. A session
blocked on a permission prompt and a session running a long tool call look
identical in the JSONL: both end in an assistant `tool_use` with no matching
`tool_result`. There is no "permission requested" record. The one distinction
that matters is exactly the one the transcripts cannot express.

Transcripts are still read, but only for display content: the last 64KB of a
file, scanned backwards for its `ai-title` and `last-prompt` records. Results
are cached against the file's mtime, so an unchanged transcript costs one
`stat` and a changed one costs a single 64KB read from the end. This matters:
these files reach tens of megabytes each.

### Deciding a session is live

Status files outlive their processes, so a session is shown only when all of:

- the JSON has a `status` key (an ungraceful exit leaves a file without one);
- `pidDomain` matches the current platform, since a pid is meaningless outside
  its own domain;
- `process.kill(pid, 0)` does not throw `ESRCH`, where `EPERM` still counts as
  alive;
- the session's socket at `messagingSocketPath` exists, which catches a pid
  recycled onto an unrelated process.

This filtering is not theoretical. Derived names are not unique over time, so a
weeks-old leftover file can carry the same name as a currently live session.

### Watching for changes

Both a directory watch and a poll, because they catch different things:

- `fs.watch` on `~/.claude/sessions`, debounced, reacts to status transitions
  immediately.
- A 5 second re-scan is the only thing that notices a session whose process
  exited. That leaves the stale file on disk and fires no filesystem event.

### Click-through

Claude Code registers `claude-vscode.editor.open`, whose first argument is a
session id. Internally it looks the id up in its own panel registry and calls
`reveal()` on an already-open chat, revives a remembered tab, or creates a panel.

Routing is the fiddly part. Reading the bundle, a session goes to the sidebar
only when all three of these hold:

```js
target = (programmatic === "honor-preferred-location"
          && preferredLocation === "sidebar"
          && !sessionAlreadyOpenInPanel) ? "sidebar" : "panel"
```

Nothing exposes that stored preference, so in sidebar mode the extension sets
it: `claude-vscode.sidebar.open` calls `setPreferredLocation("sidebar")` and
focuses the view, which also guarantees the sidebar webview exists to receive
the activation that follows. **This permanently changes Claude Code's preferred
chat location**, so new chats you start will also open in the sidebar. Set
`openLocation` to `panel` to avoid it.

In panel mode the extension instead looks for the chat's existing editor tab and
focuses it, falling back to `editor.open`. Tabs are matched by label against the
session's AI title, then its derived name, and focused by group and index, since
the API has no `tab.show()`.

The transcript opens read-only as a last resort, when the chat cannot be opened
at all.

### It never opens a terminal

No `createTerminal`, no `claude --resume`, by design.

## Limitations

- **Everything here is internal.** `~/.claude/sessions/*.json`,
  `claude-vscode.editor.open` and its argument order are not public API and can
  change in any Claude Code release. The extension fails soft: an unreadable
  directory produces one explanatory row rather than an empty panel or a thrown
  error, and click-through degrades through tab matching to the transcript.
- **Click-through is per-window.** Each VS Code window runs its own extension
  instance and acts only on itself. The list is machine-wide; the reveal is not.
- **Terminal-launched sessions** appear in the list, distinguishable by their
  `kind` and `entrypoint`, but there is no chat for them to open.
- **macOS and Linux paths.** Socket liveness assumes `messagingSocketPath` is a
  real filesystem path. Untested on Windows.

## Troubleshooting

`Claude Sessions: Debug Tab Labels` writes a report to the output channel: every
tab's label and view type, every live session, whether each one matched, and
whether `claude-vscode.editor.open` is present. Start there if click-through
stops working after a Claude Code update.

## Development

```sh
npm install
npm run watch
```

F5 launches an Extension Development Host. If the host starts and immediately
hangs, check whether VS Code's auto-attach is on: it relaunches the extension
host with `debugBrk` and waits for a debugger.

Source layout:

| File | Responsibility |
| --- | --- |
| `src/sessionStore.ts` | Read, filter, classify, and watch the status files |
| `src/liveness.ts` | Decide whether a pid and its socket are alive |
| `src/transcript.ts` | Locate a transcript and tail-read its title and last prompt |
| `src/tree.ts` | The tree view: groups, rows, icons, tooltips |
| `src/statusBar.ts` | The waiting-only status bar item |
| `src/reveal.ts` | Get to the live chat, and the fallbacks |
| `src/extension.ts` | Wire it together and register commands |

`publisher` in `package.json` is `local`. Change it before publishing anywhere.

## License

MIT
