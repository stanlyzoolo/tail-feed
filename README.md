# tail-feed

A Claude Code mod: a rail of the session's turns above the prompt input. One bar per prompt shows what its turn did,
and a click takes you back to it.

<!-- demo video: put the github.com/user-attachments URL on a line of its own here -->

Like `tail -f` on a log, each prompt lands as one new bar at the right end of the rail, and a glance at its shape tells
you what the turn did. Unlike `tail -f`, every "line" is a way back: click a bar and the transcript scrolls to that
prompt. In a long session that replaces scrolling for "where did I ask for this" and "after which prompt did the code
change".

```text
$ tail -f session.log          [-] Feed · #7/7 ──────────────────────
…                               ▂▂ ██ ▆▆ ▃▃ ▅▅ ▂▂▸██◂
12:04 edited 3 files            #7 · edits: 3 files
                                [Edit] rename the mod and fix the tests
```

- **A row of bars** above the prompt input, one bar per human prompt in the session, oldest on the left, under a
  header with the place you are reading. `[-]` at the start of the header folds the rail to one row, `[+]` unfolds it.
- **The bar's shape and colour** tell what happened in the turn after the prompt: files were edited, subagents ran, a
  skill worked, tools were called, or it was just talk. A turn with an error or an interruption is red.
- **The card** under the bars shows the bar you are reading: its number, the turn summary, the kind name and the
  prompt text. Hovering another bar shows its card instead.
- **A click** on a bar or the `/tail-feed` command scrolls the transcript to that prompt and marks it with a line
  `▸ #n/N · Kind` above it.

## Install

Needs Claude Code 2.1.325 or newer in a terminal in fullscreen rendering mode (`"tui": "fullscreen"` in settings), on
macOS or Linux.

At the prompt of a Claude Code session:

```text
/plugin install tail-feed --marketplace stanlyzoolo/tail-feed
```

From a shell it is `claude plugin install` with the same arguments. Answer `y` to `Add marketplace?` and pick a
scope; the rail appears in that session right away, once the session has a prompt to show. The mod has no settings.

- Update: `claude plugin update tail-feed@tail-feed`
- Remove: `claude plugin uninstall tail-feed@tail-feed`

A mod that draws the rows of your prompts itself (for example, prismantis) hides them from the mods under it, and the
rail gets no bars. Put tail-feed above it in `~/.claude/settings.json`:

```json
{
  "prependPlugins": ["tail-feed@tail-feed"]
}
```

## Reading the rail

A bar sums up the turn after its prompt: everything the main agent did until the next prompt. The height is the kind
of the turn, not the amount of work; the kind is the first matching row of the table.

| Bar | Kind | Colour | When |
| --- | --- | --- | --- |
| `██` | `Edit` | green | files were edited |
| `▆▆` | `Agent` | purple | subagents ran |
| `▅▅` | `Skill` | yellow | the model called a skill |
| `▃▃` | `Work` | blue | other tool calls: reads, searches, commands |
| `▂▂` | `Talk` | grey | no tool calls |
| `░░` | `Unknown` | dark grey | the turn is still running, or the prompt has no turn of its own |

- **Red** instead of the kind's colour: the turn had an error (a failed tool call, a denied permission, an API error)
  or was interrupted with Esc.
- **Cyan** means "you are here": the pointers `▸██◂` around the reading bar, `#n/N` in the header and the mark in the
  transcript. The reading bar is the bar of your last jump, or the newest one.
- **`‹N` and `N›`** count the bars that do not fit the width on each side.

## Commands

| Command | What it does |
| --- | --- |
| `/tail-feed` | one line: how many bars, which one you are reading, a hint on the arguments |
| `/tail-feed next`, `prev` | jump to the next or previous prompt from the reading one |
| `/tail-feed first`, `last` | jump to the first or last prompt of the rail |
| `/tail-feed 12`, `/tail-feed #12` | jump to prompt #12: the same number as `#12` in the bar's card |
| `/tail-feed find <words>` | jump to the newest prompt whose text has all the words |
| `/tail-feed toggle` | fold the rail to one row or unfold it, as `[-]` and `[+]` do |
| `/tail-feed-next`, `/tail-feed-prev`, `/tail-feed-toggle` | the same without an argument: for keys |

Commands work while a turn is running too. To bind keys, add the commands without an argument to the `Chat` context
of `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+x p": "command:tail-feed-prev",
        "ctrl+x n": "command:tail-feed-next",
        "ctrl+x f": "command:tail-feed-toggle"
      }
    }
  ]
}
```

## Limitations

- **Fullscreen terminal only.** No rail on the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default), in the
  desktop, VS Code and mobile apps, or while a subagent's transcript is open.
- **After `claude --resume` bars appear as you scroll.** Claude Code draws transcript rows lazily, and only a drawn row
  gets a bar. Older turns are counted in `‹N` until you scroll up to them.
- **Slash commands get no bars.** Neither do turns started by a notification, such as a finished background task.
- **A prompt typed while a turn is running** and delivered into it stays a `░░` bar: its work is in the bar of the
  previous prompt. A prompt that waited for the turn to end gets its own bar as usual.
- **The reading prompt follows jumps, not scrolling.** The wheel and PageUp do not move it; `next` and `prev` count
  from the bar of the last jump.

Every part of the rail, the answers of the commands and the rest of the limitations are in
[docs/reference.md](docs/reference.md).

## Development

Run the mod from a checkout, for that session only (do not keep an installed copy enabled next to it):

```bash
claude --plugin-dir /path/to/tail-feed
```

The checks, from the repository root:

```bash
claude plugin validate .
claude plugin test .
scripts/typecheck.sh
```

How the code is built and the rules for changing it are in [CLAUDE.md](CLAUDE.md).

## License

MIT, see [LICENSE](LICENSE).
