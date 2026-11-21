# tail-feed — notes for working with the code

A Claude Code 2.1.325+ plugin mod: a rail above the prompt input — a header, one bar per human prompt and the card of
the reading bar; the bar's shape and colour tell what happened in the turn, hover shows the card of the bar under the
mouse, a click or a command scrolls the feed to the prompt, and a jump mark appears above it in the feed; the
`[-]`/`[+]` button at the start of the header folds the rail to one row and unfolds it. What the user sees —
`README.md` (short) and `docs/reference.md` (every detail and limitation), both in English. The v1 and UX v1.1 plans
with the logs of the experiments (E1–E8) and of the live runs are not part of the published repository: everything from them that is needed to work with the code is written in this
file ("v1 plan", "UX v1.1 plan", "E1–E8" below are names of stages, not links to files).

## Layers

Each layer depends only on the layers above it in the list.

1. **`hooks/lib.ts`** — pure functions and constants, without `$` and without I/O (from `claude-code` — types only):
   the rail in `$.state` (`RAIL_SHAPE`, `EMPTY_RAIL`), rows and turns (`isHumanOrigin`, `isHumanRow`, `textKey`,
   `splitTurns`, `withoutRunning`, `commandKey`, `startedKeys`, `summarize`, `kindOf`, `MESSAGES_MAX`), binding of
   turns to rows and rewind (`bindTurns`, `markSummary`, `markBars`, `rewound`), the look of a bar (`GLYPHS`,
   `BAR_WIDTH`, `KIND_NAMES`, `KIND_COLORS`, `BAR_COLORS`, `isFlagged`, `barColor`), the bar line and the header
   (`MAX_BARS`, `beforeLabel`, `afterLabel`, `fitBars`, `barLine`, `barGaps`, `GAP`, `POINTERS`, `headerParts`; a
   segment with a colour and a weight — `Part`), folding (`FOLD_LABELS`, `FOLD_WIDTH`, `foldLabel`, `foldedLine`, `foldReply`,
   `foldNote`), the card (`barText`, `BAR_TEXT_MAX`, `CARD_ROWS`, `TOP_ROWS`, `cardLines`, `coverLines`), width in
   cells (`textWidth` — a copy from image-rail, not a dependency, with `Emoji_Presentation` on top of it), commands,
   the jump and the mark (`COMMAND_FORMS`, `COMMAND_HINT`, `parseCommand`, `findBar`, `readingIndex`, `stepTarget`,
   `commandArgs`, `aimCommand`, `jumpArgs`, `jumpedTo`, `MARK`, `markParts`, `jumpReply`, `replyOf`, `jumpNote`,
   `errorText`). The bar line — its items and the place of the reading bar — is known only to `barLine`: `fitBars`
   measures the window by it, and `railRow` draws it. The label ` Feed · #n/N` of the header and of the folded row is
   built by one function (`titleParts`), the place of `#n/N` in the header and in the mark — also by one
   (`placeLabel`). The colours of the header segments, of the gap cells and of the kind name (`CardLines.kind`,
   `MarkParts.kind`) are decided by `lib.ts`.
2. **`hooks/rail.tsx`** — `railRow`: above the rail in both views — an empty row (`TOP_ROWS`, the `paddingTop`
   padding, not a tree node). The unfolded rail is five rows whatever is hovered: the empty one, the header (the fold
   button `foldButton` with the key `FOLD_KEY` and `headerParts`: `[-] Feed · #n/N ─────` across the full width, the
   label as one `Text` with `wrap="truncate-end"`), the bar line (`barLine`: `‹N`, the bars of the window, `N›`;
   before each item and after the last one — a gap cell, at the reading bar they hold the pointers `▸██◂`) and
   `CARD_ROWS` card rows (`cardRows`): first — the visible card of the reading bar, after it the hidden cards of the
   other visible bars, padded with spaces up to its lines (`coverLines`). The folded rail is one row under the empty
   one (`foldedLine`): `[+] Feed · #n/N  ‹N ▂▂▸▂▂◂ ───`, without cards. It puts segments into `Text` (`partOf`) and
   picks no colours itself. `markLine` — the mark line `▸ #n/N · Kind` above the prompt of the last jump in the feed
   (`markParts`); `stacked` — the hook's line above whatever is lower in the chain. Keys and hover groups — `barKey`,
   `hoverKey`, `scopeOf`. It receives the rail, whether it is folded, and the table of terminal elements, and knows
   nothing about events: the jump is the `onJump` callback, folding is `onToggle`.
3. **`hooks/register.tsx`** — the atoms of the rail and of folding, the observation cache, hooks and commands: the only
   place where data meets the engine.

The state contract `PluginState['tail-feed']` (`rail`: `bars`, `older`, `current`; `folded` — the rail is folded by
its own button) is in `types/index.d.ts`. `folded` is a `boolean` without a shape tag, separate from the rail: the
rail is written only by `flush`, and `folded` only by `toggleFold`. The rail is stored with the shape tag `RAIL_SHAPE`
(`rail-2`): a value with another tag is read as an empty rail. Changed the shape of `RailState` — change the tag. The
content of the fields does not change the tag: in UX v1.1 `Bar.text` got the paste token under the same `rail-2` — the
seeded text serves as a key only until the row is redrawn, and the redraw gives the real text; the literal `rail-2` is
held by the test "a rail written by v1" in `rail.test.tsx`.

Data flow:

- the `ui.render` hook of a `UserMessage` row puts the human's row into the feed cache (`feed.rows`, `observeRow`) and
  schedules a deferred write (`schedule` → `$.clock.after(0)` → `flush`); in fullscreen it reads the rail from
  `$.state` (`readRail`) and draws the mark above the row of the `current` bar (`markParts` → `markLine`, `stacked`),
  under it — the row as is (`await next(e)`); the read subscribes the hook to the rail: the engine redraws the mounted
  rows on each write of it;
- `refresh` (on `turn.complete` of the main agent, on `session.start` and on the first row of a new feed) reads the
  session id and `$.session.messages()`, splits the transcript into turns (`splitTurns`), takes off the turn that is
  still running (`withoutRunning`), removes the rewound rows (`rewound`), remembers whether the transcript is capped
  (`MESSAGES_MAX`), and calls `flush`;
- `flush` composes the rail from rows and turns (`bindTurns`, the end-of-turn flags — `markBars`, the reading bar — by
  the last `feed.reading` event) and writes it to `$.state`; the first write after loading seeds the row cache
  (`seedRows`);
- the `ui.render` hook of the `AbovePrompt` strip reads the rail and `folded` from `$.state` (`readRail`,
  `readFolded`) and draws `railRow`;
- a click on a bar and the commands call `jump`: `$.ui.scroll`, after success — a jump event into `feed.reading` and
  `flush`;
- a click on `[-]`/`[+]` and the `toggle` command call `toggleFold`: an `update` of the `folded` atom from the latest
  value; the write redraws the strip hook that read it.

## Rules

- `ui.render` hooks do no I/O and do not write `$.state` directly: a write comes from `onPress`, from another event or
  deferred (`$.clock.after(0, …)`).
- The row hook observes the row (`observeRow`) and draws the mark above the prompt of the last jump; it changes
  nothing else in the tree. The rail is read (`readRail`) only by a human's row on `terminal`, except with
  `viewport.isFullscreen === false` (there are no jumps there); a failed read — a row without the mark (`next(e)`).
  The read reruns the row hook on each write of the rail, so only a new row schedules a write: a known one does not,
  and rows that the cache removed itself (`feed.dropped`, `dropRow`: replacement of rows without a turn, `replaced`,
  temporary rows in `beginTurn`, `rewound`) are skipped by `observeRow`, like `retired`, and `seedRows` does not seed
  them. Otherwise two identical prompts delivered into one turn would remove each other in a loop: write → redraw →
  replacement → write. Removing a row from the cache — only through `dropRow`; checking that a row is gone for good
  (removed or from `retired`) — only through `isGone`. A removed row gets no bar until the mod is reloaded (in v1 the
  next redraw brought it back) — a limitation in `docs/reference.md`.
- The strip hook only reads state and schedules nothing. There is no redraw loop: a write of the rail redraws both
  hooks, and the redraw of a known or removed row schedules no write.
- The row hook takes only rows of the `terminal` surface and draws the mark only there: rows of other surfaces would
  give bars the terminal cannot jump to.
- The strip hook draws only on `terminal` and yields (`next(e)`) on `hasSurvey`, on
  `viewport.isFullscreen === false` and when a subagent's feed is open (`view.agentId`); an empty bar window of the
  unfolded rail, an empty rail and a strip narrower than the fold button (`FOLD_WIDTH`) (`railRow` → null) and a
  failed read of the rail — also `next(e)`; a failed read of `folded` — the rail is unfolded. The width is
  `bodyColumns`. With `isCollapsed` the rail is drawn as is: the engine hides a collapsed strip ("a tree still
  returns" in the types) and writes `▸ plugin panel hidden · ctrl+x ctrl+a or click to show` instead of it. A
  collapsed strip without a tree (the hook yields, there are no other rows) disappears entirely, without that line,
  and `ctrl+x ctrl+a` no longer expands it (checked live, Claude Code 2.1.326).
- `claude plugin validate` allows passing `$` only into top-level functions of the file: `later`, `note`, `readRail`,
  `readFolded`, `toggleFold`, `schedule`, `flush`, `refresh`, `reset`, `jump`, `registerCommands`, `runCommand` are
  module functions, not closures in `register`. The `plugin` and `key` of an atom are literals. The command names are
  literals both in `$.command.register` and in the selector of the `command.run` hook (an array of names): then
  `validate` writes "answers its own command", the hook is not a gate, other mods' commands do not reach it, and it
  does not read `next`.
- Module variables are only the observation cache: the feed cache `feed` (rows, removed rows, the queue, rewritten
  texts, turns, the running turn, turn flags, the reading event, the feed's own flags; `reset` replaces it entirely,
  `newFeed`), the appearance number `nextOrder`, the feed that left `leaving` and `retired` (its rows and the removed
  ones), `generation`, the seeding and timer flags, the retry counters. `register` gives them values; at declaration
  they have none. Everything that rendering reads lies in `$.state`.
- The rail is written only by `flush`, and the jump too: `jump` puts an event into `feed.reading` and calls `flush`.
  There may be several writes in flight: `update` recomputes the rail from the latest value and retries on someone
  else's write, and the rail and the reading event are taken at the moment of computation, so a late write does not
  roll back an early one. A write happens only if the recomputed rail differs from the one read from `$.state`, not
  from a copy in the module. A failed write — a retry after `RETRY_MS`, no more than `MAX_RETRIES` times in a row; a
  successful write resets the retry count. Each write clears the timer flag: a timer that a hook rejected (`fn` will not
  be called) does not hold up deferred writes.
- The transcript is read only by `refresh`. A read is not applied if another read started or a `reset` happened after
  it began (`generation`), nor a read that still sees the id of the feed that left (`leaving`, cleared by
  `turn.start` and by an applied read): it is retried after `RETRY_MS`, no more than `MAX_RETRIES` times in a row. A
  failed read of the id or of the transcript — the rail stays as it was.
- The end of a turn (`turn.complete` of the main agent with the `turnId` of the running turn or with no known turn)
  takes the turn off before `next(e)` (`endTurn`): the start of the next turn that arrives while the hook waits does
  not lose its turn. The transcript is read in `finally` — also on a failure lower in the chain; in the same way
  `session.end` resets the feed in `finally`.
- The jump is only `jump`: `$.ui.scroll(jumpArgs(id))`, after `{}` — a jump event and `flush` (`current` through
  `jumpedTo`). A refusal (`deny`) and an exception of the call (`jump` turns it into a `deny` with the error text) do
  not change `current`; a refusal is written to the debug log (`note` → `$.ui.log(…, { to: 'debug' })`, the text is
  `jumpNote`).
- Folding is only `toggleFold` (the button — from `onPress`, the `toggle` command): an `update` of the `folded` atom.
  A failed write — the view stays as it was, a line goes to the debug log (`foldNote`), there are no retries: the
  human will press again.
- The commands are registered by `registerCommands` on `session.start`, all with `immediate: true` (the jump and
  folding by key work during a turn too), through `Promise.allSettled`: a failed registration does not get in the way
  of reading the transcript. The reply: a successful jump and a successful fold — `{}` without text, a refusal —
  `didn't jump to #n: <deny as is>`, a failed fold — `didn't toggle the rail: …` (`foldReply`), a failed read of the
  rail — `rail unavailable: …` (folding does not read the rail), the rest — a line from `aimCommand`; the lines go
  through `replyOf` (`isTextDisplayOnly: true`). There are no toasts.
- The v1 boundary (UX v1.1 does not change it): the code has no classic hooks, no reading of `.jsonl`, no `$.fs`,
  `$.process`, `$.http`, `$.store`, `$.model`, no network, no writes to disk, no polling, no strip focus, no
  `userConfig`. The `validate` report on calls names only `$.clock.after`, `$.command.register`, `$.session.id`,
  `$.session.messages`, `$.ui.invalidate`, `$.ui.log`, `$.ui.resolve`, `$.ui.scroll` and the state calls
  (`$.state.get`, `$.state.set`; it reads and writes only `tail-feed.rail` and `tail-feed.folded`).
- The look of the rail was chosen by the user (the brainstorm and the UX v1.1 plan): `GLYPHS` — variant B "Height"
  (`▂ ▃ ▅ ▆ █ ░`), a bar is the kind's glyph `BAR_WIDTH = 2` times; `KIND_COLORS` — each kind has its own colour;
  `BAR_COLORS` — `flagged` (an error or an interruption, instead of the kind's colour), `current`, `line` (the
  header lines) and `title` (the word `Feed` of the header and of the folded row, bold — `Part.weight` — in Claude's
  brand peach `#d97757`, the only colour outside Nord; chosen by the user after 0.1.3, the word was `Tail` before).
  The palette is Nord in hex and does not depend on the Claude Code theme. The light blue
  `BAR_COLORS.current` means only "you are here": the pointers of the reading bar, the `#n/N` of the header, the mark
  in the feed; the reading bar itself is in the kind's colour. `KIND_NAMES` — the kind names (nouns): the card puts
  them before the prompt text (`[Edit] …`), the mark — after the number (`▸ #4/6 · Edit`), both in the kind's colour,
  also for a flagged turn. All of them change together with the tree tests in `rail.test.tsx`, `rows.test.tsx` (the
  mark) and `lib-layout.test.ts`.
- Folding was chosen by the user (the brainstorm after UX v1.1): the `[-]`/`[+]` button (`FOLD_LABELS`, not `▾`/`▸`)
  at the start of the header in the colour of the lines; `#n/N` — right after `Feed · `, there is no separate bar
  count in the header; the folded rail is one row with bars that can be clicked, without a card; the state is in the
  session (`$.state`), without `$.store`; without a mouse — `/tail-feed toggle` and `/tail-feed-toggle`, the strip
  has no key of its own. After the live check of 0.1.2 — an empty row above the header in both views (`TOP_ROWS`) and
  the pointers `▸██◂` (`POINTERS`) instead of the corners `▕██▏`: the corners read poorly, and `▸` repeats the jump
  mark in the feed.
- Everything in the repository is in English: the text the user sees (the summary, the replies and descriptions of
  the commands, the debug log, `description` in `.claude-plugin/plugin.json`, `README.md`, `docs/reference.md`), code comments, tests and
  `CLAUDE.md`. There is no Cyrillic anywhere in the repository.

## Non-obvious facts

Feed rows (E1, E5, E7):

- `UserMessage` rows are drawn lazily. After `claude --resume` — only those mounted near the window, the rest — when
  the window reaches them, in chunks from the bottom up (inside a chunk — from the top down). A reload of the mod and
  `/resume` inside the process draw all rows in feed order (the reload was checked on 3 and 7 prompts),
  `$.ui.invalidate('ui.render')` — only the mounted ones. The `requestId` of a row is stable across redraws, a reload
  and `--resume`. So only the rows drawn in this process have bars, the turns older than the first bar are the number
  `older`, and the rows stand by the index of the bound turn, not by the order of appearance.
- After a reload of the mod the row cache is seeded from the written rail (`seedRows`, the first write): the bars of
  the rows the engine did not redraw stay. The key of a seeded row comes from `Bar.text` (with the paste token, no
  longer than 300 characters) until the engine redraws the row and gives the real text.
- A prompt that was just submitted and a slash command are first drawn with `requestId: 'placeholder'` (one id for all
  submissions); the row gets its real id after `turn.start`. `isHumanRow` skips such a row.
- Slash commands (of skills and local ones) and the mod's commands do not draw `UserMessage` rows with a real id; the
  mod's commands give neither `prompt.submit` nor a turn and do not get into `messages()`. No separate filter is
  needed.
- A prompt submitted during a turn of the main agent is first drawn under temporary ids (in the experiment — two, at
  +3 and +170 ms; the number is a rendering detail, the mod does not rely on it). The order from the E5 log: for a
  waiting prompt — the `turn.complete` of the previous turn, `placeholder`, the final row and only then its
  `turn.start`; for a prompt delivered into the running turn the final row comes in the same turn, there is no
  `turn.start`. The temporary rows disappear without an event.
- A human's `prompt.submit` during a turn (a turn of the main agent is running, or `turnId` names a turn that the mod
  did not see finish — a turn from before the mod was loaded) puts the text key into `queued`. A new row of a key from
  `queued` has no turn of its own (`isTurnless`): a temporary one or one delivered into the turn; it deletes the
  `isTurnless` rows of its key seen in this turn. At the end of the turn the `queued` keys move to `waiting` (`Wait`:
  the turn number `endedAt` and the newest row of the key after its end) and lie there without counting turns: they
  leave with the start of their turn, with a new submission of the same text and with a submission when no turn is
  running (`dropQueue`: the engine's queue is empty then — the keys, the row replacement, `isDraining` and `isHeld`
  are cleared). A new submission of the same text does not touch the row of a delivered prompt.
- A new row of a key from `waiting` is the row of a waiting prompt: the final one or a late temporary one (the turn
  ended before the second temporary one came, +170 ms). It is held (`isHeld`) until the end of the turn and replaces
  the temporary rows of the key and its own previous row while that one is held (`replaceWaiting` → `replaced`): the
  newest one is the final one. The replaced rows leave on the next `turn.start` of the main agent, not at once —
  until then, tens of ms, the rail shows both: a row of the same text drawn by scrolling after `claude --resume`
  cannot be told from the row of a waiting prompt, and a submission when no turn is running cancels the replacement.
- `turn.start` (`beginTurn`, with a deferred write) starts the waiting prompts by `startedKeys`: a prompt with the key
  of the turn's text (one rewritten lower in the chain — by `landed`), a slash command (`commandKey`: `/name
  arguments` from the tags `<command-name>`, `<command-args>`) or several prompts merged by the engine into one (the
  text key is joined from their keys with a space in queue order). Their temporary rows leave, the rows after the end
  of the previous turn are held until the end of this one, and the row of the turn's prompt (`promptRow`, `isLive`)
  is the row of the waiting prompt with the turn's text, even if the end of a notification's turn has already
  released it; for merged ones — the newest row with the turn's text after the end of the previous turn; if there is
  none — the first row of the key (`awaitsRow`). A turn that started no waiting prompt does not touch their rows.
- From the start of a turn from the queue until a submission when no turn is running (`isDraining`), a row without a
  turn of a key from `waiting`, seen since the turn of its submission, stands at the very end of the rail, after the
  held ones (`railRows` → `isQueued`): the prompts that are still waiting come after the prompt of the running turn.
  A prompt delivered into the turn cannot be told from a waiting one: if another prompt waited in the queue in the
  same turn, the bar of the delivered one is also at the end until the next submission.
- Not checked live (one prompt waited in the experiment): how the engine drains a queue of several prompts (a turn
  per prompt or one turn; the turn's text — of the first prompt or their join; a row per prompt or one shared row),
  whether it draws a queued slash command with temporary rows, what text the temporary rows of a prompt rewritten
  lower in the chain have. The rules above hold all these variants (`rows.test.tsx`). They do not hold: a local
  command in the queue (it has no turn — the temporary row, if there is one, stays a `░░` bar), a join with
  non-space characters, and a row that scrolling after `claude --resume` drew with the text of a prompt delivered
  into the turn while its key is in `waiting`, if the next turn to start is not from a human's submission (a
  notification): it will replace the bar of the delivered prompt.
- A prompt delivered into the running turn gives neither a `turn.start` nor an entry in `messages()`: its row is an
  `unknown` bar between the bound ones, it is not bound by text (`isTurnless`).
- `isLive` — the row of a prompt that the mod saw submitted: the row of the turn's prompt and the rows of a key from
  `queued`. Only they reset `current`. Rows drawn by scrolling during a turn (after `claude --resume`) are not
  `isLive`: they are bound at once and do not touch `current`. `isHeld` — a prompt whose turn has not ended yet (the
  row of the turn's prompt and the row of a waiting prompt): it is not bound (a repeated "yes" would take the summary
  of the previous "yes") and stands at the end of the rail; the end of the turn clears `isHeld` from all rows. A
  transcript read when the turn was already running holds its prompt: `refresh` takes off the last turn with the
  text of `turn.start` (`withoutRunning`), otherwise the earlier row of the same text would take it.
- The place of an unbound row (`slotOf`) — by its neighbours in the order of appearance: a continuation of a chunk —
  after the row before it; the prompt of the previous turn (`isLive`) — after the newest bound row seen before it;
  otherwise before the bound row seen after it, if that one is older than the bound row before it (a chunk from the
  bottom up); and when the transcript is capped (`MESSAGES_MAX` entries) and the row of the transcript's first turn is
  already visible — at the start of the rail. Chunks without bound rows cannot be told apart: a row at the edge of
  such a chunk may land in the neighbouring place.
- The text of a row matches the text of the transcript entry in full, with the `<pasted_content id="xxxx">…` blocks
  and the `[Image #n]` tags: they stay in `textKey`. In `Bar.text` the paste block is replaced with the token
  `[Pasted text +N lines]` (`pastedToken`: `N` — the lines of the block's content, `+1 line`, an empty block —
  `[Pasted text]`), and `[Image #n]` stays as is. The engine's prompt input counts line breaks for the same paste —
  one less (the UX v1.1 live run: `[Pasted text #1 +5 lines]` for 6 lines, prismantis in the feed — `6 lines`).
  `find` searches `Bar.text`, so `find pasted` finds prompts with a paste — accepted deliberately (the `findBar`
  test, `docs/reference.md`). For the search the token is the single word `pasted` (`findBar`, `PASTED_TOKEN`): `find text` and
  `find lines` do not match the token.
- Binding is by `textKey` from the end: in a group of identical texts the newest turns take the newest rows. `isLive`
  rows are newer than the rest; the order of the rest is not the order of appearance (chunks from the bottom up) but
  their place in a draft rail composed without the groups that have two or more such rows (`matchTurns`: `pairTurns`
  → `placeRows` → `pairTurns`). A prompt rewritten by a hook lower in the `prompt.submit` chain is bound by the text
  from the reply of `next(e)` (`landed`, `noteLanded`); `context` added by another mod was not checked.

Transcript (E5, E7):

- Service `user` entries: `[Request interrupted by user]` (Esc) and `[Request interrupted by user for tool use]` (a
  permission denial) — the whole entry — flag the current turn; `<task-notification>`,
  `<command-message>`/`<command-name>` and the `/compact` summary (`This session is being continued from a previous
  conversation…`) close the turn and start a turn without a bar; `<local-command-stdout>` and
  `<local-command-stderr>` are skipped; a `user` entry with `toolResults` does not start a turn, even with text.
- `isError` is set by the engine: a failed command (`ls` of a missing directory, failed tests) and a permission
  denial — yes, `rg` without matches and `test -f` with exit code 1 — no.
- Esc gives `turn.complete` with `reason: 'aborted'`; a permission denial — `reason: 'answer'`, visible only in the
  transcript. An API error and a model refusal (`error`, `refusal`) are not in the transcript: `endTurn` writes the
  flag into `marks` by the id of the row of the turn's prompt (`promptRow`; a notification and a slash command have
  none), not by text — a row with the same text drawn by scrolling during the turn will not get it; `composeRail`
  puts the flag on the summary on each write (`markBars`). After a reload of the mod, `/resume` and
  `claude --resume` these flags are lost.
- The summary sticks to the bar: an unbound bar keeps the written summary. Otherwise the labels of old bars would
  vanish after `/compact` and after `messages()` is capped at 4096 entries.
- `$.session.messages()` returns the newest 4096 entries (`MESSAGES_MAX`); that many means the transcript is capped
  (`isCapped`). On 486 entries a read takes 3–7 ms: a read on each `turn.complete` is acceptable.

Feed change (E6, E7):

- `session.start` comes on the load of the mod but not on `/clear`; the commands live on after `/clear`. `/clear` and
  `/resume` bring `session.end` (`clear`, `resume`) with the id of the leaving session → `reset` and `invalidate`;
  other reasons (`logout`, `prompt_input_exit`, `other`) do not change the feed. The engine keeps drawing rows of the
  feed that left after `session.end` too: they are in `retired` and do not go into the cache; the next feed change
  replaces the set. The rows that the cache of the feed that left removed itself (`feed.dropped`) also go into
  `retired`: otherwise its replaced row, drawn after `/clear`, would become a bar of the new feed. The transcript of
  the new feed is read on its first row (`isUnread`), without waiting for a turn. Another id without `session.end` —
  `reset` without `retired`. `/resume` of the same session: a read with its id is not applied until a turn starts in
  it.
- `/rewind` removes the rows past the rewind point without an event. `rewound` finds them in `refresh` by turns, not
  by the order of appearance (after `--resume` the rows are seen from the bottom up); there is no full reset —
  `invalidate` would bring back only the mounted rows. A rewind to the very start and a rewind with the same prompt
  text are not recognised.
- The mod's `$.state` is tied to the session: after `/clear` and `/resume` it is empty. So `flush` compares with what
  it read, and `RailState` does not store the session id.
- The engine sometimes rejects a write of `$.state` from a timer in the first hundreds of ms after the module loads
  (`state.set: denied: it was made while ui.render is being dispatched`; in the v1 experiment — 3 writes out of ~230,
  at 120–300 ms; in the UX v1.1 live run, 7 minutes, 11 prompts and 8 jumps, — none). `flush` retries after
  `RETRY_MS = 50`, no more than `MAX_RETRIES = 20` times in a row; the reading event (`feed.reading`) lives until the
  next event and is not lost on a failure.

The jump, the mark and the strip (E2–E4, E8, the UX v1.1 live run):

- `$.ui.scroll({ to: { requestId }, block: 'start' })` reaches a row far outside the window and during a turn too; it
  moves the feed only while the call answers a human's action. Refusals: `nothing drawn under that requestId` (a
  subagent's feed is open, there is no row), `transcript not scrollable here` (not fullscreen). Submitting a command
  from the prompt input first scrolls the window to the end, the jump then leads to the target.
- The engine accepts a command reply `{}` without `text` and draws no row. The `text` of a third-party mod gets into
  the model's context unless `isTextDisplayOnly: true` is set (`replyOf`): then the line is for the human only;
  during a turn the engine may keep it in the request (this is how the types describe the flag).
- `onScreen` does not work for the reading prompt: a jump and a scroll to the end do not report `null` to the rows
  that left the window. The reading bar is the bar of the last jump (`current`), without it — the newest one
  (`readingIndex`).
- The mark appears after `$.ui.scroll`, when the window has already settled, and live it is the first row of the
  window under the engine's sticky header (`❯ <text of the prompt above>`), the prompt of the jump is right under it.
  The same holds for a jump forward when the mark of the previous jump was above the target (`/tail-feed 2`, then
  `next`): the worry "the new mark will go past the top of the window" was not confirmed. At the end of the feed,
  where the window scrolls no further (`/tail-feed last`), the mark stands above the prompt but is not the first row
  of the window.
- `/export` was not checked live. The engine waits for the hook's reply on export rows ("`/export` waits" in the
  `ui.render` types, export is a surface without ctrl+o, `isExpanded: true`), so the mark of the last jump may get
  into the exported text. It cannot be cut off by `isExpanded`: ctrl+o and `--verbose`, where the mark is needed,
  have the same flag.
- The engine redraws a row hook that read `$.state` on each write of the rail ("Also on a write of `$.state` it read
  while drawn" in the types). Live, a jump gave 14–28 row renders in ≤120 ms (3–4 passes over 7–9 mounted rows: the
  write of the rail, the shift of the feed by the mark), a turn — 5–27 per second; there are no renders between
  events. A separate atom for the mark (`mark`, variant B of the brainstorm) — only if the feed starts to lag.
- Hover is declarative, the hook does not learn about it: the card of the reading bar is always visible and stands
  first, the cards of the other visible bars lie after it hidden (`display: "none"`, `position: "absolute"` — drawn
  over those standing earlier) and are shown by group (`hover: { scope, display: "flex" }`). A `Box` has no cells of
  its own: the letters of the visible card are overwritten by the padding spaces of the hidden one (`coverLines`) —
  only up to the width of the visible card's lines, not up to `columns`, otherwise the tree would go over the budget.
  A group name is up to 64 characters, hence `c<index>`, not the row id. Keys: the button — `bar:<id>`, the hover
  area — `hover:<id>`.
- The card is in permanent rows under the bars: a `Box` with `position: "absolute"` is clipped by the area of its
  place, and above the rail it would lie on another mod's row or be clipped by the edge of the strip.
- The pointers are gap cells, not a frame around the bar: the width of the bar line does not depend on the reading
  bar, and the cells at the start and at the end of the line give room for the pointers of a bar at the edge of the
  window. `▸` and `◂` are one cell each (East Asian Width N).
- `Button` has no colour: the glyph is a `Text` inside a `plain` button (two cells, `BAR_WIDTH`). The terminal draws
  dimmed text in its own colour, so the bars are not dimmed: a bar is in the kind's colour `KIND_COLORS`.
- Under the pointer and in focus the engine inverts a button. For a bar this breaks the look: for `▂▂` the top of
  the cell above an empty stripe becomes coloured (the bar "jumps"), `██` becomes an empty cell (it vanishes). The
  engine draws a `plain` button as a `Text` with `{ inverse, dimColor, ...hover styles }`: the button's `hover`
  styles come after the inversion, and `hover={{ inverse: false }}` on the bar's button removes it (by the engine
  code of 2.1.327, live with a mouse — the user on 0.1.3; in the types — "under the pointer itself the button inverts
  as it always has"). Hover is shown by the card; keyboard focus (ctrl+x tab) inverts the bar, as before. The
  `[-]`/`[+]` button is text, its inversion stays.
- The `[-]` at the right edge of the strip is the engine's: it is always drawn when the strip is not collapsed and
  has at least one row (`position: "absolute"`, `top: 0`, `right: 1`, in five cells beyond `bodyColumns`, after the
  mods' rows). Neither a hook nor a setting removes or covers it; only `ctrl+x ctrl+a` (`abovePrompt:toggle`) can be
  unbound, not the marker itself (Claude Code 2.1.326, by the engine code). So the rail's own folding is the
  `[-]`/`[+]` button at the start of the header, and the engine's `[-]` stays on the right: `docs/reference.md` says how
  they differ. `top: 0` is the top row of the strip: with the empty row above the header (`TOP_ROWS`) it stands in that
  row, not in the header row (live, 2.1.327).
- The strip puts one row per mod; the tail-feed hook does not see other mods' rows (the selector is by `plugin` by
  default), and keeps `next(e)` under its own row. prismantis draws no row of its own in the strip, but draws the
  `UserMessage` rows itself and does not call `next(e)`: tail-feed sees the rows only while it stands in the chain
  above it — `prependPlugins` in the settings (the `prepend` level) or, on the same `user` level, loaded earlier
  (`--plugin-dir`). The tree limit (100,000 characters) is shared by all rows of the strip; the rows are counted
  from the top, and the engine does not draw a row past the limit (`AbovePrompt` in the types). The rail stays within
  half of it: `JSON.stringify(await ui.drawn())` of the rail in the harness is about 1200 characters per bar with a
  card of 300 characters and a row id as long as a UUID, hence `MAX_BARS = 40`: 48.2k with 150 bars, 400 columns and
  prompts about code with quotes, with the former 120 bars — 131k. More than half — only in a wide strip: the padding
  repeats a full-width summary of the reading bar in the first line of each hidden card, and JSON doubles quotes and
  backslashes — up to 74.3k at 400 columns (a full-width summary and prompts made of nothing but quotes and
  slashes), 57.6k at 200, 49.6k at 133. Lowering `MAX_BARS` for this case — about 26 bars at any width; 40 was kept
  (the UX v1.1 review). The harness fields `press` and `group` (~75 characters per bar) are in the measurement;
  whether the engine's limit counts them was not checked. At 120 columns the rail is limited by the width (38 bars).
- The strip together with the prompt input is no more than half of the screen (`maxRows`); the rows that do not fit
  go under `↓ N more`, the wheel scrolls the strip. A rail of 5 rows (with the empty one) fits whole at 22 and 26
  terminal rows, at 20–21 the card is under `↓ 2 more`, at 18–19 the bar line too (`↓ 3 more`), at 15 — the whole
  rail (`↓ 5 more`; the 0.1.2 live run, Claude Code 2.1.327). A rail of 4 rows fit whole at 21 too. The numbers below
  about image-rail are a measurement of a rail of 4 rows. The image-rail tile (an image in the prompt input) takes
  `min(12, maxRows − 3)` rows and leaves no room for other mods' rows: at 31, 36 and 41 terminal rows the tail-feed
  rail is entirely under `↓ 5 more`, at 49 the card is under `↓ 2 more` (the v1 rail of 3 rows fit there); at 21 and
  25 rows the tile does not fit, and image-rail yields itself. The mod's own hook does not see other mods' rows, it
  knows only `maxRows`; what to do is the user's decision.

## Tests

- `tests/*.test.ts(x)`, run with `claude plugin test .`, without a terminal and without a model.
- `tests/lib-turns.test.ts` — `isHumanOrigin`, `isHumanRow`, `textKey`, `summarize`, `kindOf`, `splitTurns`,
  `withoutRunning`, `commandKey`, `startedKeys`, `bindTurns` (only the prompt of the running turn is held, rows
  without a turn, queue rows at the very end, identical texts in chunks from the bottom up and next to an `isLive`
  row, the places of unbound rows in chunks from the bottom up, a capped transcript, `older`), `markSummary`,
  `markBars`, `rewound`; the transcript entries are in the form `$.session.messages()` returned them in the
  experiment.
- `tests/lib-layout.test.ts` — `textWidth`, `GLYPHS`, `KIND_NAMES`, `KIND_COLORS`, `isFlagged`/`barColor`,
  `jumpArgs`/`jumpedTo`, `MARK`/`markParts` (the place of `#n/N` — as in the header), `fitBars`, `barGaps`/`barLine`,
  `FOLD_LABELS`/`foldLabel`, `headerParts`, `foldedLine`, `barText`, `cardLines`, `coverLines`,
  `COMMAND_FORMS`/`COMMAND_HINT`, `parseCommand` (and `toggle`), `findBar`, `stepTarget`, `readingIndex`,
  `commandArgs`, `aimCommand`, `jumpReply`, `foldReply`/`foldNote`, `replyOf`, `jumpNote`; the bar line is assembled
  as text from `barLine` (`drawnLine`), its width is recomputed through `textWidth` and checked against `columns` for
  widths 0…200, like the width of the header (`columns − FOLD_WIDTH`), of the folded row and of the card;
  `find pasted` finds prompts with a paste, and `text`, `lines` and the token's line count do not.
- `tests/rows.test.tsx` — rows give bars, `placeholder` and non-human rows do not, temporary rows of the queue (a
  waiting, a delivered and a withdrawn prompt, one and three temporary rows, a turn from before the mod was loaded,
  the `turnId` of a finished turn, `bridge`, non-human prompts), a queue of several prompts (a turn per prompt, one
  turn with the text of the first, prompts merged into one), a late temporary row after the end of the turn, a final
  row before a notification's turn, a rewritten prompt and a slash command in the queue, the end of a subagent's
  turn, the race of the end and the start of a turn, a rewritten prompt, the reset of `current`, the shape tag, the
  race of writes, a rejected timer, a denied write and retries; the mark above the prompt of the jump through
  `$.ui.mount` of a `UserMessage` row (`mountRow`: the look and the colours, only at the `current` row, none without
  a jump, on `desktop`, outside fullscreen and on a failed read of the rail, cleared by a new prompt; a new row is
  one write, its redraw does not touch the rail; a row outside fullscreen is a bar too), the redraw of removed rows
  without writes (including a temporary row that the start of a waiting prompt's turn removed before its final row),
  seeding does not bring back a row removed before the first write after a reload.
- `tests/turns.test.tsx` — summaries after `turn.complete`, the interruption and error flags, a failed read of the
  transcript and of the id, the order of bars after `claude --resume` (and scrolling during a turn, a capped
  transcript), repeated text (a scroll row and a submitted prompt, the error flag, a delivered and a waiting prompt,
  a scroll row with the text of a delivered one), a reload of the mod (the seeded text is with the paste token), a
  prompt at the end of the rail, a feed change (`/clear`, `/resume`, a retried read, `/resume` of the same and of
  the previous session, the queue at the change and rows of the feed that left drawn after it, including those
  removed by its cache, a change of id without `session.end`, other `session.end` reasons), `/compact`, `/rewind`
  (the redraw of rewound rows does not bring bars back), races of transcript reads.
- `tests/rail.test.tsx` — the rail through `$.ui.mount` of `AbovePrompt`: the header with the `[-]` button, kinds,
  colours, the bar's button without inversion under the pointer (`hover: { inverse: false }`), the reading bar (the
  pointers and `#n/N`), the rail of 5 rows (the empty one is the `TOP_ROWS` padding), the folded rail (one row under
  the empty one, a click on a bar, `[-]`/`[+]` writes `folded` and redraws the rail, a failed read and write of
  `folded`, widths 0…200, an empty rail), the counters, the cards (the reading one first, the hidden ones in index
  order, the padding, the colour of `[Kind]`) and the hover groups, the card in a narrow strip and at widths 0…200,
  when the rail is not drawn, a failed read of `$.state`, another mod's row, the v1 rail (the tag literal `rail-2`:
  read without a reset), a press, the size (150 bars, `bodyColumns: 400`, ids as long as a UUID: with prompts about
  code the strip's tree is no more than 50,000 characters, in the worst case — a full-width summary of the reading
  bar and prompts made of nothing but quotes and slashes — no more than 80,000).
- `tests/commands.test.tsx` — registration with `immediate` and a failed registration, the target of each argument
  form, replies without a jump, `toggle` and `/tail-feed-toggle` (the write of `folded`, a failed read of the rail
  does not get in its way, a denied write), a failed read of the rail, other mods' commands, the mod's command gives
  no bar, the guard "the harness does not replace `ui.scroll`". The bottom of the `command.run` chain (the core) is
  the test's hook.
- `tests/smoke.test.ts` — the module loads, the list of registrations: "event + selector" pairs; the engine admits
  the mod for loading.
- The shared world of hooks is `tests/world.tsx` (not `*.test`, the harness does not run it): stubs of `session.id`
  (`isIdBroken`), `session.messages` (`isMessagesBroken`), the read of the rail (`isStateBroken`), `mock.clock`
  (without it `$.clock.after` fails in a test), `command.register` (`world.commands`, `deniedCommand`), `ui.log`
  (`world.logs`), the bottom of the event chains (`prompt.submit` rewrites the text with `rewrite`), counters
  (`calls.set` — attempts to write the rail, `calls.invalidate`), denial of writes (`deniedWrites`), writes of the
  rail (`stage(…)` → `last()` and `all()`), transcript entries (`human`, `reply`, `tool`, `tools`, `results`,
  `INTERRUPTED`, `INTERRUPTED_FOR_TOOL`, `NOTIFICATION`, `COMPACT_COMMAND`, `COMPACT_STDOUT`, `COMPACT_SUMMARY`,
  `PASTED`, `IMAGE` — the `lib.ts` tests take them too), the turn summary (`summary`) and actions (`render`,
  `mountRow` — a row that the test holds (`MountedRow`; the arguments are as for `render`, then the window), `markOf`
  — the jump mark above it, `draw` — also `clock.settle()`, `submit` — with an optional `turnId`, `deliver` — a
  prompt delivered into the turn, `startTurn`, `completeTurn`, `startSession`, `changeSession`). `seedRail` puts a
  rail "from before the reload" (version 0; the function is read on each read), `watchFold` — the writes of `folded`
  (`writes`), their denial (`denied`), a failed read (`isBroken`) and the value before the first write, `gateWrite`
  delays the write of the rail, `gateMessages` — the read of the transcript, `gateComplete` — the bottom of the
  `turn.complete` chain.
- A submitted prompt in a test is `startTurn`, then `draw`: this is how it goes in a live session (E1), and only such
  a row is the row of the turn's prompt. A waiting prompt is `completeTurn`, a `draw` of the final row, then
  `startTurn` (the E5 log). A repeated submission of a text that waited in the queue, and a prompt after the queue
  has drained, the test starts with `submit`, as in a live session: a submission when no turn is running clears the
  `waiting` keys (`dropQueue`).
- A deferred write waits for the clock: after a row is drawn — `clock.settle()`, a retry after a denial and a retried
  read — `clock.advance(50)`.
- The test's `$` has no `state`: the writes are visible through the test's `state.set` hook; the harness's `$.state`
  is not tied to a session.
- `$.ui.mount` of the strip draws the whole strip: the rows of all mods in a stack. `find` does not return an
  element's `hover` — the hover groups are read from `drawn()`.
- `$.ui.mount` of a `UserMessage` row redraws it after a write of the rail that the hook read, like the engine: no
  `redraw` is needed. The engine's row in `drawn()` is the node `{ type: 'engine' }`, its presence —
  `keepsBeneath()`.
- The test's `$.command.run` requires `origin` and `presentation` (the mod's `CommandRunArgs` does not have them).
- The mod's `$.ui.scroll` cannot be replaced in the harness (Claude Code 2.1.326): the call goes to the host
  implementation, which the harness does not have, and throws `no implementation for ui.scroll`. It is not seen by
  the test's hook `on('ui.scroll', …)` with any selector, by `on('*', …)` or by the test's built-in plugin; the
  engine rejects a replacement of `$.ui` in `engine.create`. So the jump is checked in parts: a click on a bar of the
  real strip — by the refusal line in the debug log (`world.logs`, `jumpNote` with the bar's id), `current` is not
  written; the argument of the call and the rail after a successful jump — `jumpArgs` and `jumpedTo`; the link
  "button → bar id" also by the real `railRow` in the test's `Pane` with a callback instead of `jump` (the buttons of
  such a panel are pressed with `plugin: 'test'` in `mount`). The commands — by the bar number in the refusal reply
  (`didn't jump to #n: … ui.scroll`); the reply of a successful jump (`{}`) is held by `jumpReply`. The harness does
  not execute the successful-jump branch in `jump` (the jump event and the write); the live jump and the mark were
  checked in the v1 and UX v1.1 live runs. The row tests get the mark from a seeded `current` (`seedRail`), not from
  a jump. When the harness learns to replace `ui.scroll`, the guard in `commands.test.tsx` will fail.

## Checks

From the root, after each code change:

```bash
claude plugin validate .
claude plugin test .
scripts/typecheck.sh
```

Types — only through `scripts/typecheck.sh`, not a bare `tsc -p .`. `tsconfig.json` extends
`.claude-plugin/types/tsconfig.json`, and Claude Code lays out that directory (in `.gitignore`) only when the mod is
loaded in an interactive session (`claude --plugin-dir .`): in a fresh checkout, in a git worktree and after
`claude -p` it is missing, and `tsc` fails on `extends`, or even emits `.js` next to the sources. The script takes the
types of the `claude --version` version: from `.claude-plugin/types/`, from another worktree of the repo or from the
`claude-code.d.ts` that the engine writes when the `plugin-authoring` skill is loaded
(`/tmp/claude-<uid>/bundled-skills/<version>/…`; there the API, the built-in tools and `claude-code/testing` are one
file, so the `types` of its tsconfig has only `claude-code`). If it finds none, and `.claude-plugin/types/` holds
types of another version — it checks against them with a warning; if those are missing too — it writes how to get them
(load `/plugin-authoring` or the mod interactively) and exits with code 2. There is no `tsc` on the machine: the
script calls it through `npx`.

Expected `validate` warnings: `ICON_MISSING`, "CLAUDE.md at the plugin root is not loaded as project context" (this
file is for development, not for the plugin's users), the note "gating hook without .catch: prompt.submit" (the hook
only observes, and skipping it on a failure is what is needed; `.catch` is for a hook that denies).

Publishing: the repository is its own marketplace (`.claude-plugin/marketplace.json`, one entry with
`"source": "./"`), the install is `/plugin install tail-feed --marketplace stanlyzoolo/tail-feed`, the key of the
installed mod is `tail-feed@tail-feed` (the same one is in users' `prependPlugins`: do not change the marketplace
name). With `"source": "./"` the whole repository is copied to the user, with `tests/` and this file: keep no personal
paths or addresses in them. Changes reach those who installed it only with a new `version` in `plugin.json`
(`claude plugin update`); the version is only there, the marketplace entry has none. `engines["claude-code"]` in
`plugin.json` is the minimum engine version: outside the range the mod is disabled entirely.

Live check: `claude --plugin-dir .` in a terminal in fullscreen mode; in agterm — as a companion session, as in the v1
and UX v1.1 live runs: `session new --parent "$AGTERM_SESSION_ID" --no-select --command "zsh -lc
'~/.local/bin/claude --plugin-dir … --debug-file …'"` — the PATH of the agterm app has no `~/.local/bin`, and without
the wrapper the session closes at once (`no such session`). Prompts are typed with `agtermctl session type` (a paste
is a bracketed paste `\033[200~…\033[201~`, otherwise the first line break submits the prompt), the screen is read
with `session text`, a low terminal is a horizontal split (`session split on --axis horizontal`,
`session resize --split-ratio`). `agtermctl` sends no mouse, and the text styles of the screen are not visible:
hover, click and colours are checked by the user.
