# tail-feed

A Claude Code mod: a rail of the session's turns above the prompt input.

Think of `tail -f` on a log. You keep it open in a corner, each event lands as one new line at the end, and a glance
tells you what just happened. tail-feed does the same for the session's feed: each prompt lands as one new bar at the
right end of the rail, and the bar's shape tells you what its turn did. The difference is that `tail -f` only lets the
lines go by, while here every "line" is a way back: click a bar and the feed scrolls to that prompt.

```text
$ tail -f session.log          [-] Tail · #7/7 ──────────────────────
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

Why: in a long session (reviews, rounds, planning) the only way to find "where did I ask for this" and "after which
prompt did the code change" is scrolling. The rail gives an overview of the session in one row and a jump in one
action.

## Requirements

- Claude Code 2.1.325 or newer.
- A terminal in fullscreen rendering mode (`"tui": "fullscreen"` in settings): only there Claude Code scrolls the
  transcript itself and reports clicks. On the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default) there is no
  rail.
- macOS or Linux.

## Install

At the prompt of a Claude Code session in a terminal:

```text
/plugin install tail-feed --marketplace stanlyzoolo/tail-feed
```

Or from a shell:

```bash
claude plugin install tail-feed --marketplace stanlyzoolo/tail-feed
```

Claude Code asks `Add marketplace?` (answer `y`), then for a scope (the user scope comes first, Enter takes it). The
rail appears in that session right away, without a restart, once the session has a prompt to show.

The mod has no settings. To update it after a new release: `claude plugin update tail-feed@tail-feed`. To remove it:
`claude plugin uninstall tail-feed@tail-feed`.

### With mods that draw your prompts

A mod that draws the rows of your prompts in the transcript itself (for example, prismantis) hides those rows from the
mods under it, and the rail gets no bars. Put tail-feed above such a mod in `~/.claude/settings.json`:

```json
{
  "prependPlugins": ["tail-feed@tail-feed"]
}
```

The list is read from the user settings only.

## The rail

A human prompt gets a bar: one typed in the prompt input or sent through Remote Control. Task notifications, messages
from subagents, plugins and other sessions, and slash commands get no bar.

The rail takes five rows of the strip above the prompt input: an empty row that sets it apart from the transcript, the
header, the bars and two card rows; folded, it takes two (see "Folding"). The height does not depend on hover, so the
prompt input does not move. Rows of other mods (for example, image-rail tiles) stand in the strip on their own rows.

After a jump to the second prompt:

```text
                                              [-]
[-] Tail · #2/7 ────────────────────────────
 ▂▂▸██◂▆▆ ▃▃ ▅▅ ▂▂ ░░
#2 · edits: 2 files · error
[Edit] fix the tests and run the checks
```

The `[-]` on the empty row is Claude Code's own, not the rail's (see "Folding").

### Header

`[-] Tail · #n/N ─────` spans the whole strip. `#n/N` is the place of the reading bar: `n` is the same number as `#n`
in the card and in `/tail-feed <n>`, `N` is the number of bars (older turns without a bar are not counted, see
"Counters"). In a narrow strip the line gets shorter first, then `#n/N` is dropped, then `Tail` is cut; `[-]` stays.

### Bar kinds

A bar sums up the turn after its prompt: everything the main agent did from that prompt to the next one. When the turn
ends, the mod reads the session transcript and counts the turn's tool calls. The kind is the first matching row of the
table, top to bottom, so a turn that edited files and also ran subagents is `Edit`. Each bar is two cells wide. The
kind name stands in the card before the prompt text and in the transcript mark.

The height of a bar is its kind and nothing else: the higher the kind stands in the table, the taller the bar, from
`▂▂` for talk to `██` for edits. How much was done does not count: a turn with one edited file and a turn with twenty are both `██`. The
numbers are in the first row of the card: `edits: 20 files`, `calls: 7` (see "Card"). `░░` is a shade at full height,
not a height.

| Bar | Name | Colour | When |
| --- | --- | --- | --- |
| `██` | `Edit` | green `#a3be8c` | files were edited successfully (`Edit`, `Write`, `NotebookEdit`) |
| `▆▆` | `Agent` | purple `#b48ead` | subagents ran (`Agent`, `Workflow`) |
| `▅▅` | `Skill` | yellow `#ebcb8b` | the model called a skill with the `Skill` tool |
| `▃▃` | `Work` | blue `#81a1c1` | other tool calls: reads, searches, commands |
| `▂▂` | `Talk` | grey `#616e88` | no tool calls |
| `░░` | `Unknown` | dark grey `#4c566a` | the turn is still running or is not tied to the prompt (see "Known limitations") |

- Edits, subagents and skills count only calls without an error: a turn with one denied edit is `▃▃` in red.
- Only the main agent's calls count. What a subagent does in its own transcript is not counted: a turn whose only call
  is `Agent` is `▆▆`, however many files the subagent edited.
- Errors and interruptions do not change the kind, only the colour (see below).

Colours are the Nord palette, the same in every theme:

- a turn with an error or an interruption is red `#bf616a` instead of its kind's colour, the shape stays. An error is a
  tool call that failed (including a command with a non-zero exit code, failing tests, a denied permission), an API
  error or a model refusal; an interruption is Esc;
- cyan `#88c0d0` means "you are here": the pointers `▸██◂` on both sides of the reading bar, `#n/N` in the header and
  the mark in the transcript. The reading bar itself keeps its kind's colour;
- the header lines and the `[-]`/`[+]` button are grey `#616e88`.

The reading bar is the bar of the last jump (click or command). Before any jump, and after you send a new prompt, the
reading bar is the newest one.

Shapes, names and colours are the constants `GLYPHS`, `BAR_WIDTH`, `KIND_NAMES`, `KIND_COLORS` and `BAR_COLORS` in
`hooks/lib.ts`. Colours do not follow the Claude Code theme: on a light background the cyan is pale.

### Card

Without hover the two card rows show the card of the reading bar. Hovering another bar shows its card in the same
rows, over the reading bar's card; hovering the reading bar changes nothing.

- The first row, dimmed, is the number and the turn summary joined by ` · `: `edits: N files`, `subagents: N`,
  `skill: name` or `skills: a, b`; if none of these, `calls: N` or `talk`; then `error` or `errors: N`, and
  `interrupted`. A `░░` bar has `no summary`. If it does not fit, it is cut at the end.
- The second row is the kind name in brackets, in the kind's colour (`[Edit]`, `[Talk]`, …), and the prompt text on one
  line; if it does not fit, it is cut with `…`. A block of pasted text shows as `[Pasted text +N lines]` (`+1 line`; an
  empty block is `[Pasted text]`), where `N` is the number of lines in the pasted text. Claude Code's prompt input
  counts line breaks instead and shows one less: `[Pasted text #1 +5 lines]` for six lines. Image tags `[Image #n]`
  stay as they are.

`#n` is the number of the bar in the rail, counted from one: the same as in `/tail-feed <n>`.

### Mark in the transcript

A jump puts a line above the prompt it jumped to:

```text
▸ #2/7 · Edit
```

`▸ #n/N` is cyan, the kind name is in the kind's colour. After the jump the mark is the top line of the transcript
window, under Claude Code's sticky prompt header, and the prompt is right below it; near the end of the transcript,
where the window cannot scroll that far, the mark stays above the prompt lower in the window. Only the last jump has a
mark; sending a new prompt removes it.

### Counters

If the bars do not fit the width, the rail shows a window of bars and counters of the hidden ones: `‹N` on the left,
`N›` on the right. The window stands at the right end of the rail, and the reading bar is always in it: a jump to an old
prompt moves the window. The left counter also includes turns older than the first bar that have no row in the
transcript yet (see "Known limitations"). No more than 40 bars are visible: the cards of all visible bars are kept in
the strip at once, and the strip has a size limit shared with the rows of other mods.

There is no rail when there are no bars (a new session, `/clear`), when the strip is narrower than one bar with its
counters (folded: narrower than the `[+]` button), when a subagent's transcript is open, or when a Claude Code survey
stands above the prompt input.

### Folding

`[-]` at the start of the header folds the rail to one row, `[+]` unfolds it. The folded row keeps the place and the
bars, without the card:

```text
                                                  [-]
[+] Tail · #2/7  ▂▂▸██◂▆▆ ▃▃ ▅▅ ▂▂ ░░ ──────────
```

A click on a bar of the folded row jumps the same way; hover shows no card. When no bar fits, the row is
`[+] Tail · #n/N ───`, so the button that unfolds it is always there. `/tail-feed toggle` and `/tail-feed-toggle`
do the same as the button. The folded state belongs to the session: a new session, `/clear` and `/resume` start
unfolded.

The `[-]` at the right end of the empty row above the header is Claude Code's own: it stands on the top row of the
strip and hides the whole strip, the rows of other mods included, and leaves
`▸ plugin panel hidden · ctrl+x ctrl+a or click to show`; `ctrl+x ctrl+a` toggles it too. A mod can neither hide nor
move it.

## Commands

| Command | What it does |
| --- | --- |
| `/tail-feed` | one line: how many bars, which one you are reading, a hint on the arguments |
| `/tail-feed next`, `prev` | jump to the next or previous prompt from the reading one |
| `/tail-feed first`, `last` | jump to the first or last prompt of the rail |
| `/tail-feed 12`, `/tail-feed #12` | jump to prompt #12: the same number as `#12` in the bar's card |
| `/tail-feed find <words>` | jump to the newest prompt whose text has all the words (case does not matter) |
| `/tail-feed toggle` | fold the rail to one row or unfold it, as `[-]` and `[+]` do |
| `/tail-feed-next`, `/tail-feed-prev`, `/tail-feed-toggle` | the same as `next`, `prev` and `toggle`, without an argument: for keys |

`find` searches the bar text: the prompt cut to 300 characters, where a pasted block counts as the one word `pasted`.
So `/tail-feed find pasted` jumps to the newest prompt with pasted text, while `find text` and `find lines` look for
those words only in what you typed.

Commands work while a turn is running too. A successful jump or toggle gives no answer line; the only trace of a jump in
the transcript is the mark above the prompt. If a jump or a toggle is not possible, the command answers with one line
saying why; Claude Code puts `tail-feed: ` in front of it:

| Command | Answer |
| --- | --- |
| `/tail-feed` | `8 bars, reading #5. /tail-feed next, prev, first, last, toggle, <n>, #<n>, find <words>` |
| `/tail-feed` on an empty rail | `no bars. /tail-feed next, prev, …` |
| `/tail-feed 99` | `no prompt #99: the rail has 8 bars` |
| `/tail-feed 0`, `/tail-feed #0` | `no prompt #0` |
| `/tail-feed find release` | `not found: "release"` |
| `/tail-feed find` without words | `find needs words: /tail-feed find <words>` |
| `/tail-feed next` on the last bar | `#8 is the last in the rail` |
| `/tail-feed prev` on the first bar | `#1 is the first in the rail` |
| `/tail-feed abc` | `didn't understand "abc": /tail-feed next, prev, …` |
| any jump on an empty rail | `no bars — nowhere to jump` |
| Claude Code refused to scroll | `didn't jump to #4: <the reason as Claude Code gave it>` |
| the rail could not be read | `rail unavailable: <the error>` |
| the folded state could not be saved | `didn't toggle the rail: <the error>` |

If some turns are older than the first bar, the help, `prev` on the first bar and the empty-rail answer add
`; 3 older turns above without a bar`.

The answer line is for you only: it does not go to the model's request (Claude Code promises this for a mod command's
answer; during a turn it may still add it). If a jump or a toggle fails, by a click or a command, a line about it goes
to the debug log (`claude --debug`): `tail-feed: didn't jump to row <id>: <reason>` or
`tail-feed: didn't toggle the rail: <the error>`.

Keys: commands without an argument are bound in `~/.claude/keybindings.json` with the action `command:<name>` in the
`Chat` context. For example, `ctrl+x p`, `ctrl+x n` and `ctrl+x f` (free chords on the `ctrl+x` prefix):

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
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

If the file already exists, add these lines to its `Chat` block without replacing the rest.

## Known limitations

- **Terminal, fullscreen mode and the main transcript only.** On the main screen, in `desktop`, `vscode`, `mobile` and
  while a subagent's transcript is open there is no rail and no mark.
- **Bars only for rows Claude Code drew in this process.** Transcript rows are drawn lazily: after `claude --resume`,
  only the rows near the window; the rest when scrolling reaches them. Turns older than the first bar are counted in
  the left counter `‹N`, and you cannot jump to them. Scroll the transcript up and the bars appear. While the rail
  grows this way, bar numbers shift. Reloading the mod does not lose bars: the rail written before the reload stays.
- **The reading prompt follows jumps, not scrolling.** The wheel and PageUp do not move it, and `next` and `prev`
  count from the bar of the last jump. `first`, `last` and a number always go to their target.
- **Slash commands get no bars.** Skill commands (`/review`), built-in ones (`/compact`) and mod commands do not draw a
  prompt row, and the work of a turn started by a skill command goes to no bar. The `▅▅` kind is only for a skill the
  model called itself. Turns started by a notification (a background subagent or command finished) get no bar either.
- **A prompt delivered into a running turn** (typed while the model is calling tools) stays a `░░` bar: it has no turn
  of its own, its work is in the bar of the previous prompt. A prompt that waited for the turn to end gets its own bar
  as usual, also when several are queued. While the queue drains, the bars of prompts that are still waiting stand at
  the end of the rail; if another prompt waited in the queue during the same turn as the delivered one, the delivered
  one's bar also stands at the end until the next prompt is sent.
- **A replaced row does not come back.** The row of a prompt delivered into a running turn replaces the rows with the
  same text that came without a turn earlier in that turn: its temporary rows and the row of an identical prompt
  delivered before it, so two identical prompts delivered into one turn have one `░░` bar. An old row with that text,
  first drawn by scrolling during the turn (after `claude --resume`), takes the delivered prompt's bar the same way. A
  replaced row gets no bar even when Claude Code draws it again; a mod reload brings it back.
- **A prompt taken back from the queue** into the prompt input leaves a `░░` bar. The mod cannot tell it from a prompt
  delivered into a turn (both are drawn as temporary rows, and no events about them follow), and the bar of a real
  prompt must not be lost. A jump to such a bar fails: its row is no longer in the transcript.
- **A queue of several prompts was not tested live.** The v1 experiment saw one waiting prompt. The mod is built for a
  turn per queued prompt, one turn for the whole queue, prompts merged into one, and a slash command typed during a
  turn. A local command (`/color`) typed during a turn may leave a `░░` bar. If after `claude --resume` scrolling draws
  an old prompt with the same text as a prompt delivered into a turn, and the next turn is started by a notification
  rather than your prompt, the delivered prompt's bar disappears.
- **`/rewind`.** The bars of rewound prompts go away only after the next turn ends: there is no rewind event, the mod
  sees it when it reads the transcript. A rewind to the very first prompt, and a rewind after which the same prompts
  are sent again, are not recognised: the bars of the rewound prompts stay.
- **API error and model refusal marks** come from the turn-end event, they are not in the transcript: after a mod
  reload, `/resume` and `claude --resume` they are lost. An Esc interruption and a denied permission are in the
  transcript and stay.
- **Same text.** The mod tells prompts with the same text ("yes", "go on") apart by their place in the transcript: a
  prompt sent in this process is newer than rows drawn by scrolling, and rows drawn in chunks after `claude --resume`
  take their place from neighbouring bars with other text. If a row has no such neighbours in its chunk (a chunk of
  repeats only, or without bars that have a turn), its bar may take the place of another prompt with the same text and
  its summary; a click on it still scrolls to its own row.
- **Long session.** The mod sees the newest 4096 transcript entries: rows of older turns, first drawn after
  `claude --resume`, get a `░░` bar at the start of the rail, but between chunks drawn by scrolling their order may be
  wrong. Summaries counted earlier stay with their bars, including after `/compact`.
- **Order of bars without a turn after `claude --resume`.** Transcript rows come in chunks from the bottom up, and the
  mod places the bar of a prompt without a turn (delivered into a turn) by the neighbouring bars that have one. If such
  a row is at the edge of its chunk, its bar may stand one place off.
- **Low terminal.** The strip together with the prompt input takes at most half the screen; rows that do not fit go
  below `↓ N more`, and the strip scrolls with the wheel. The rail fits whole from about 22 terminal rows; at 20–21
  the card goes below `↓ 2 more`, at 18–19 the bars too, at 15 the whole rail does. While an image is in the prompt input, the image-rail tile
  takes the whole strip in a terminal of about 31–49 rows, and the rail is partly or fully below `↓ N more` until the
  prompt is sent.
- **`/export` was not checked live.** Claude Code draws the rows of an export through the same hooks as the
  transcript, so the mark line `▸ #n/N · Kind` of the last jump may end up in the exported text.
- **Mouse and colours were checked by hand only.** Automated live runs (agterm on macOS, fullscreen) went by the text
  on the screen: bar kinds, header, the reading-bar pointers, card, the mark in the transcript, the paste token and
  commands, including during a turn, after `/clear`, `/resume`, `/compact`, `/rewind` and `claude --resume`. Hover over
  bars, clicks on bars and on `[-]`/`[+]`, and colours were checked by hand in a live session (version 0.1.3) and are
  otherwise covered by tests.

## Next iteration

- choosing a bar with keys inside the strip (focus, arrows, Enter);
- a "review round" mark with the round number;
- memory between sessions: turning the rail off, bookmarks on prompts;
- a one-sentence turn summary from the model;
- a panel layout with the list of prompts.

## Development

Run the mod from a checkout, for that session only:

```bash
claude --plugin-dir /path/to/tail-feed
```

Do not keep an installed copy enabled next to it: both would hook the same events.

The checks, from the repository root:

```bash
claude plugin validate .
claude plugin test .
scripts/typecheck.sh
```

Claude Code lays out the API types (`.claude-plugin/types/`, in `.gitignore`) only when it loads the mod in an
interactive session (`claude --plugin-dir .`). `scripts/typecheck.sh` lays them out itself when they are missing (a
fresh checkout, a git worktree) and runs `tsc`: it copies the types of your Claude Code version from another worktree
of the repository or from the file Claude Code writes when the `plugin-authoring` skill loads. If it finds neither, it
checks against the types of another version already in `.claude-plugin/types/` and warns, and when there are none it
says how to get them and exits with code 2.

How the code is built and the rules for changing it are in [CLAUDE.md](CLAUDE.md).

## License

MIT, see [LICENSE](LICENSE).
