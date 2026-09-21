# Claude Session Monitor

A VS Code sidebar that shows which of your Claude Code sessions need you, which
are working, and which are idle. Click one to jump to that chat.

Run several Claude Code sessions at once and they all look the same. This tells
you which one is sitting on a permission prompt.

```
Needs you (1)
  🔴 Refactor auth middleware           my-project-4f · permission prompt
Working (1)
  🔄 Investigate flaky integration test my-project-c8 · 2s
Idle (2)
  ⚪ Port the CLI to async              my-project-ae · 18m
  ⚪ Document the release process       other-repo-52 · 2h 44m
```

Rows are named after what the session is actually doing, covering every project
on your machine.

How it gets your attention, in increasing order of insistence:

- **Colour.** Row labels are tinted by state, red for blocked, blue for
  working, amber for a session that has been busy too long without changing.
  All four colours are themeable.
- **Badge.** The activity bar icon carries a count of blocked sessions.
- **Status bar.** Appears only when something is blocked, showing how long the
  oldest one has waited. Amber at first, red past a threshold you set.
  Optionally blinks.
- **Notification.** When a session newly blocks, with a button that takes you
  straight there. Only transitions are announced, so nothing nags on a loop.

## Install

Requires VS Code 1.90+ and the Claude Code extension.

```sh
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension claude-session-monitor-*.vsix
```

Reload the window and look for the Claude Sessions icon in the activity bar.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `openLocation` | `sidebar` | Open clicked chats in the Claude sidebar or an editor tab |
| `notifyWhenWaiting` | `true` | Notify when a session newly needs you |
| `escalateAfterMinutes` | `2` | When the status bar turns from amber to red |
| `statusBarPulse` | `false` | Blink the status bar bell while waiting |
| `pollIntervalMs` | `5000` | How often to re-scan |
| `stuckAfterMinutes` | `15` | Warn when a busy session stops changing status |
| `showIdle` | `true` | Show the Idle group |
| `hideEmptyGroups` | `false` | Hide groups with no sessions |
| `claudeHome` | `~/.claude` | Override the Claude directory |

All prefixed `claudeSessionMonitor.`. The four state colours are contributed as
`claudeSessionMonitor.waiting`, `.stuck`, `.busy` and `.idle`, overridable
through `workbench.colorCustomizations`.

## How it works

Claude Code writes a status file per running session at
`~/.claude/sessions/<pid>.json` containing `status` (`busy`, `idle`, or
`waiting`) and, when waiting, why. The extension watches that directory and
groups what it finds. Conversation transcripts are read only for row titles.

It deliberately does not infer state from the transcripts. A session blocked on
a permission prompt and one running a long tool call look identical in the
JSONL: both end in a `tool_use` with no matching `tool_result`. The distinction
that matters is the one the transcripts cannot express.

Clicking a row hands the session id to Claude's own `claude-vscode.editor.open`
command, so you land in the real chat rather than a copy.

## Caveats

- Built on internal Claude Code files and commands, not public API. A Claude
  update could break it. It fails soft rather than throwing.
- In `sidebar` mode, opening a chat sets Claude's preferred location to the
  sidebar, which affects new chats you start. Use `panel` mode to avoid that.
- The list covers your whole machine, but clicking only works for the VS Code
  window the extension is running in.
- Developed on macOS. Untested on Windows.

## Development

```sh
npm install && npm run watch
```

F5 opens an Extension Development Host. If it hangs on launch, turn off VS
Code's auto-attach, which pauses the extension host waiting for a debugger.

`Claude Sessions: Debug Tab Labels` reports what the extension can see, which is
the place to start if click-through breaks.

## License

MIT
