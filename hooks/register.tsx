// Hooks: observing the feed rows and the main agent's turns, reading
// the transcript, the feed change, the deferred write of the rail to
// `$.state`, the strip's rail, the mark above the prompt of the last jump, the
// jump to a prompt, folding the rail and the commands. The hook of the
// `UserMessage` row observes the row and draws the jump mark above it: it does
// no I/O, reads the state, and writes deferred (`schedule`; why there is no
// redraw loop — `Feed.dropped`). The hook of the `AbovePrompt` strip reads
// only the state.

import { atom, read, update } from 'claude-code'
import type {
  CommandRunResult,
  EngineInterface,
  Register,
  SessionMessage,
  TurnCompleteReason,
  UiScrollResult,
} from 'claude-code'

import type { Bar, RailState } from '../types'
import {
  aimCommand,
  barText,
  bindTurns,
  COMMAND_HINT,
  commandArgs,
  EMPTY_RAIL,
  errorText,
  foldNote,
  foldReply,
  isHumanOrigin,
  isHumanRow,
  jumpArgs,
  jumpedTo,
  jumpNote,
  jumpReply,
  markBars,
  markParts,
  MESSAGES_MAX,
  parseCommand,
  RAIL_SHAPE,
  replyOf,
  rewound,
  splitTurns,
  startedKeys,
  textKey,
  withoutRunning,
} from './lib'
import type { Row, Turn } from './lib'
import { markLine, railRow, stacked } from './rail'

// `plugin` and `key` are literals: from them `claude plugin validate` lists
// what the module reads and writes.
const railAtom = atom({ plugin: 'tail-feed', key: 'rail' } as const, EMPTY_RAIL, { shape: RAIL_SHAPE })

// Whether the rail is folded by its own button (`[-]`/`[+]`). Separate from the
// rail: only `flush` writes the rail, and this is the human's choice; `$.state`
// is bound to the session, so a new session, `/clear` and `/resume` start with
// an unfolded rail.
const foldAtom = atom({ plugin: 'tail-feed', key: 'folded' } as const, false)

/** After how many milliseconds to retry a rejected write or read (E6). */
const RETRY_MS = 50

/**
 * How many times in a row to retry a rejected write or a read that still sees
 * the id of the feed that left. The engine rejects writes from a timer
 * in the first hundreds of milliseconds after loading (E6); 20 retries of
 * 50 ms each is a second. After that nothing is retried until the next change
 * of the rows or the end of a turn.
 */
const MAX_RETRIES = 20

/**
 * The last event of this process that decides which bar is the reading one:
 * a submitted prompt (`fresh`, submitting scrolls the window to the end of the
 * feed, E2) or a successful jump to bar `id`.
 */
type Reading = { kind: 'fresh' } | { kind: 'jump'; id: string }

/** A human row in the module's cache. */
type Seen = Row & {
  /** How many main-agent turns had ended when it appeared (`Feed.ends`). */
  since: number
  /**
   * Taken from the written rail after a mod reload: the key is from the bar's
   * text, the engine has not redrawn the row yet.
   */
  isSeeded?: boolean
}

/** A human prompt submitted during a turn, after the end of that turn (`Feed.waiting`). */
type Wait = {
  /** `ends` of the turn during which the prompt was submitted: its turnless rows were seen in that turn. */
  endedAt: number
  /**
   * The newest row of the key after the end of that turn — the final row of
   * the waiting prompt or its late temporary one; null — there has been none yet.
   */
  row: string | null
}

/** The observation cache of one feed; `reset` replaces it whole. */
type Feed = {
  /** Human rows seen in this process, by `requestId`. */
  rows: Map<string, Seen>
  /**
   * Rows the cache removed itself (`dropRow`): replaced turnless rows and rows
   * of waiting prompts (`replaced`), temporary rows of a turn that has started,
   * rewound rows (`rewound`). The row hook reads the rail and is redrawn on
   * each write of it: if such a row came back into the cache, two identical
   * prompts delivered into one turn would remove each other in a loop (write
   * → redraw → replacement → write). So `observeRow` skips them, like
   * `retired`.
   */
  dropped: Set<string>
  /**
   * Keys of human prompts submitted during a running turn of the main agent:
   * their rows in this turn are temporary ones or the row of a prompt
   * delivered into the turn (`isTurnless`); a new one replaces the earlier ones.
   */
  queued: Set<string>
  /**
   * Keys from `queued` of ended turns, in queue order. Such a prompt waits for
   * its turn (its rows come after the end of the turn, before its
   * `turn.start`), is delivered into the turn or taken out of the queue: only
   * its new row and the start of its turn (`startedKeys`) tell them apart. A
   * key leaves with the start of its turn, a new submission of the same text
   * and a submission while no turn is running (the queue is empty then,
   * `dropQueue`) — not by a count of turns.
   */
  waiting: Map<string, Wait>
  /**
   * Rows replaced by a new row of a waiting prompt (`observeRow`): they leave
   * on the next `turn.start` of the main agent. The replacement does not
   * survive a submission while no turn is running: there are no waiting prompts
   * then.
   */
  replaced: Set<string>
  /**
   * The turn of a prompt from the queue has started, and since then there has
   * been no submission while no turn is running: the queue is draining, the
   * turnless rows of keys from `waiting` are at the end of the rail
   * (`isQueued`).
   */
  isDraining: boolean
  /** Key of the typed text → key of the text that reached the session (a hook below rewrote the prompt). */
  landed: Map<string, string>
  /** The transcript turns of the last read. */
  turns: readonly Turn[]
  /** The last read of the transcript was capped (`MESSAGES_MAX`). */
  isCapped: boolean
  /** `turnId` of the running turn of the main agent; null — no turn is running. */
  runningTurn: string | null
  /** `turnId` of the last ended turn of the main agent. */
  endedTurn: string | null
  /** `textKey` of the text the running turn started with. */
  startedKey: string | null
  /** There has been no row of the running turn's prompt yet: the first row with `startedKey` is its row. */
  awaitsRow: boolean
  /** The row of the running turn's prompt; null — none (not arrived yet or the turn was not started by a human). */
  promptRow: string | null
  /** The end-of-turn flag from `turn.complete` (not `answer`) by the id of the row of its prompt. */
  marks: Map<string, TurnCompleteReason>
  /** How many main-agent turns have ended. */
  ends: number
  /** The session the cache and the turns belong to; null — not read yet. */
  session: string | null
  /** The feed changed, and its transcript has not been read yet: a new row asks for a read. */
  isUnread: boolean
  /**
   * The last event for the reading bar; null — there were no events, the
   * reading bar is the written one (`current` from before the mod reload).
   */
  reading: Reading | null
}

function newFeed(): Feed {
  return {
    rows: new Map(),
    dropped: new Set(),
    queued: new Set(),
    waiting: new Map(),
    replaced: new Set(),
    isDraining: false,
    landed: new Map(),
    turns: [],
    isCapped: false,
    runningTurn: null,
    endedTurn: null,
    startedKey: null,
    awaitsRow: false,
    promptRow: null,
    marks: new Map(),
    ends: 0,
    session: null,
    isUnread: false,
    reading: null,
  }
}

// The module variables are only the observation cache: everything rendering
// reads lies in `$.state`. `register` gives them their values; after a mod
// reload the row cache is seeded from the written rail (`seedRows`) and the
// engine redraws the rows.

// The cache of the current feed.
let feed: Feed
// The first-appearance number of the next new row.
let nextOrder: number
// The session that `session.end` closed: a read that still sees its id came
// before the feed change and is not applied.
let leaving: string | null
// Rows of the feed that `session.end` closed, and rows its cache removed
// itself: the engine keeps drawing them after it too, they do not go into the
// cache of the new feed.
let retired: Set<string>
// The number of the transcript read; `reset` moves it too. A read after whose
// start the number has moved does not apply its result.
let generation: number
// The first write after loading still has to seed the row cache from the
// written rail; a feed change cancels the seeding: the written rail belongs to
// another feed.
let isSeedPending: boolean
// A deferred write is scheduled and has not started yet.
let isScheduled: boolean
// Retries of a rejected write in a row.
let retries: number
// Retries in a row of a read that still sees the id of the feed that left.
let rereads: number

/** `$.clock.after` that does not throw; false — the timer is not set. */
function later($: EngineInterface, ms: number, fn: () => void): boolean {
  try {
    $.clock.after(ms, fn)

    return true
  } catch {
    return false
  }
}

/** A line to the debug log (`claude --debug`), not to the screen. */
function note($: EngineInterface, text: string): void {
  try {
    $.ui.log(text, { to: 'debug' })
  } catch {
    // No log — the line is lost.
  }
}

/**
 * The rail from `$.state` for the `ui.render` hooks: cannot be read — null,
 * the hook yields (`next(e)`). The command reads the rail itself: the error
 * text goes into its reply.
 */
async function readRail($: EngineInterface): Promise<RailState | null> {
  try {
    return await read($, railAtom)
  } catch {
    return null
  }
}

/** Whether the rail is folded (`foldAtom`) for the strip hook: cannot be read — unfolded. */
async function readFolded($: EngineInterface): Promise<boolean> {
  try {
    return await read($, foldAtom)
  } catch {
    return false
  }
}

/**
 * Fold or unfold the rail (the `[-]`/`[+]` button, the `toggle` command):
 * toggle `foldAtom` from the last value. A failed write — the view stays as it
 * was, a line goes to the debug log (`foldNote`); returns the error text, on
 * success — null.
 */
async function toggleFold($: EngineInterface): Promise<string | null> {
  try {
    await update($, foldAtom, (folded) => !folded)

    return null
  } catch (err) {
    const error = errorText(err)
    note($, foldNote(error))

    return error
  }
}

/**
 * Remove a row from the cache for good: its repeated render (`observeRow`) and
 * the seeding (`seedRows`) will not bring it back (`isGone`, `Feed.dropped`).
 */
function dropRow(id: string): void {
  feed.rows.delete(id)
  feed.dropped.add(id)
}

/** The row is out of the cache for good: the cache removed it (`dropRow`) or it is from a closed feed (`retired`). */
function isGone(id: string): boolean {
  return retired.has(id) || feed.dropped.has(id)
}

/**
 * Remember a human row. A known row and a row that is out of the cache for
 * good (`isGone`: the cache removed it or it is from a closed feed) change
 * nothing; a row seeded from the written rail gets its real key and text. A
 * new row:
 *
 * - the first in the turn with the text key of `turn.start` (`awaitsRow`) —
 *   the row of the running turn's prompt (the row gets its real id after
 *   `turn.start`, E1);
 * - with a key from `waiting` — the row of a waiting prompt: the final one
 *   comes after the end of the previous turn, before its own `turn.start` (E5
 *   log), a temporary one — after the end of the turn too, if it ended right
 *   after the submission. It is held until the end of the turn and replaces
 *   the rows of this prompt (`replaceWaiting`): the newest is the final one;
 *   `turn.start` makes it `isLive` and the row of the turn's prompt
 *   (`beginTurn`);
 * - with a key from `queued` — a temporary row or the row of a prompt
 *   delivered into the turn (`isTurnless`): it replaces the earlier rows of
 *   this key seen in this turn, however many there are.
 *
 * The row of the turn's prompt and the `queued` rows are `isLive`: the newest
 * bar becomes the reading one again. Rows drawn later by scrolling or by a mod
 * reload do not change the reading bar.
 *
 * @returns whether the set of rows changed
 */
function observeRow(id: string, text: string): boolean {
  const known = feed.rows.get(id)

  if (isGone(id) || (known !== undefined && known.isSeeded !== true)) {
    return false
  }

  const typed = textKey(text)
  const key = feed.landed.get(typed) ?? typed

  if (known !== undefined) {
    feed.rows.set(id, { id, key, text: barText(text), order: known.order, since: known.since })

    return true
  }

  const isPrompt = feed.awaitsRow && key === feed.startedKey
  const wait = isPrompt ? undefined : feed.waiting.get(typed)
  const isTurnless = !isPrompt && wait === undefined && feed.queued.has(typed)

  if (isPrompt) {
    feed.awaitsRow = false
    feed.promptRow = id
  }

  if (isTurnless) {
    for (const [other, row] of feed.rows) {
      if (row.key === key && row.isTurnless === true && row.since === feed.ends) {
        dropRow(other)
      }
    }
  }

  if (wait !== undefined) {
    replaceWaiting(key, wait)
    wait.row = id
  }

  const isLive = isPrompt || isTurnless
  const isHeld = isPrompt || wait !== undefined
  feed.rows.set(id, { id, key, text: barText(text), order: nextOrder++, since: feed.ends, isLive, isHeld, isTurnless })

  if (isLive) {
    feed.reading = { kind: 'fresh' }
  }

  return true
}

/**
 * A new row of the waiting prompt with key `key` has come: its temporary rows
 * (`isTurnless`, seen since the turn of the submission) and its earlier row
 * after the end of the turn, while it is held (a late temporary one), are
 * replaced — they leave on the next `turn.start` (`replaced`). The removal is
 * deferred: a row of the same text drawn later by scrolling cannot be told
 * from the row of a waiting prompt, and a submission while no turn is running
 * cancels the replacement (`dropQueue`).
 */
function replaceWaiting(key: string, wait: Wait): void {
  for (const row of feed.rows.values()) {
    const isEarlier = row.id === wait.row ? row.isHeld === true : row.isTurnless === true && row.since >= wait.endedAt

    if (row.key === key && isEarlier) {
      feed.replaced.add(row.id)
    }
  }
}

/**
 * The human submitted a prompt while no turn is running: the engine's queue is
 * empty, there are no waiting prompts. The `waiting` keys leave, the
 * replacement of rows (`replaced`) is cancelled, rows are no longer held: only
 * rows of waiting prompts could be held.
 *
 * @returns whether the rows or their place in the rail changed
 */
function dropQueue(): boolean {
  let changed = feed.waiting.size > 0 || feed.replaced.size > 0

  for (const row of feed.rows.values()) {
    if (row.isHeld === true) {
      row.isHeld = false
      changed = true
    }
  }

  feed.waiting.clear()
  feed.replaced.clear()
  feed.isDraining = false

  return changed
}

/**
 * The prompt reached the session rewritten (a hook lower in the
 * `prompt.submit` chain): the transcript keeps the text `landed`, the row —
 * the typed `typed`. Rows seen since the submission (`from`) are bound by
 * `landed`.
 *
 * @returns whether the key of any row changed
 */
function noteLanded(typed: string, landed: string, from: number): boolean {
  if (landed === typed) {
    return false
  }

  feed.landed.set(typed, landed)
  let changed = false

  for (const row of feed.rows.values()) {
    if (row.key === typed && row.order >= from) {
      row.key = landed
      changed = true
    }
  }

  return changed
}

/**
 * The rail from the row cache (`railRows`) and the last turns over the written
 * one: a bound bar takes the turn summary, an unbound one keeps the written
 * one (`bindTurns`); the end-of-turn flag (`marks`) is put on the summary
 * (`markBars`). The reading bar — by the last event (`reading`): after a
 * submitted prompt — the newest again, after a successful jump — the bar of
 * the jump (`jumpedTo`). The event is read at the moment of the computation,
 * so a write recomputed by `update` after someone else's does not roll it
 * back.
 */
function composeRail(stored: RailState): RailState {
  const { bars, older } = bindTurns(railRows(), feed.turns, { previous: stored.bars, isCapped: feed.isCapped })
  const rail = { bars: markBars(bars, feed.marks), older, current: stored.current }
  const { reading } = feed

  if (reading === null) {
    return rail
  }

  return reading.kind === 'fresh' ? { ...rail, current: null } : jumpedTo(rail, reading.id)
}

/**
 * The cache rows for the rail. While the queue is draining (`isDraining`), a
 * turnless row of a key from `waiting`, seen since the turn of its submission,
 * is a prompt still waiting in the queue (or delivered into the turn: they
 * cannot be told apart) and stands at the end of the rail (`isQueued`), not
 * before the turn that is running.
 */
function railRows(): Iterable<Row> {
  if (!feed.isDraining || feed.waiting.size === 0) {
    return feed.rows.values()
  }

  const since = new Map<string, number>()

  for (const [typed, wait] of feed.waiting) {
    since.set(feed.landed.get(typed) ?? typed, wait.endedAt)
  }

  return [...feed.rows.values()].map((row) => {
    const endedAt = since.get(row.key)

    return row.isTurnless === true && endedAt !== undefined && row.since >= endedAt ? { ...row, isQueued: true } : row
  })
}

/** The rail values are the same: nothing to write. */
function isSameRail(a: RailState, b: RailState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Seed the row cache with the bars written before the mod reload: the engine
 * may not redraw every row (in a long feed `invalidate` redrew one
 * of 17, E1), and their bars remain jump targets. The order of appearance is
 * the order of the rail, earlier than all the rows of this process; the key
 * is from the bar's text until the engine redraws the row (`observeRow`).
 */
function seedRows(bars: readonly Bar[]): void {
  bars.forEach((bar, i) => {
    if (!feed.rows.has(bar.id) && !isGone(bar.id)) {
      const order = i - bars.length
      feed.rows.set(bar.id, { id: bar.id, key: textKey(bar.text), text: bar.text, order, since: feed.ends, isSeeded: true })
    }
  })
}

/**
 * Schedule a deferred write of the rail: no more than one per tick. A
 * `ui.render` hook cannot write itself (`state.set` during rendering is
 * forbidden). After a feed change a new row also asks to read the
 * transcript of the new session. A timer that is not set or never fired (a
 * hook rejected `clock.after`) is cleared by the next write (`flush`).
 */
function schedule($: EngineInterface): void {
  if (isScheduled) {
    return
  }

  isScheduled = true

  const isSet = later($, 0, () => {
    isScheduled = false
    void flush($)

    if (feed.isUnread) {
      void refresh($)
    }
  })

  if (!isSet) {
    isScheduled = false
  }
}

/**
 * Recompute and write the rail: read the written one, compare it with the
 * recomputed one and, if it differs, write (`update` recomputes from the last
 * value and retries on someone else's write between the read and the write, so
 * a write with old data does not land over a write with new data). The first
 * write after loading seeds the row cache (`seedRows`). A failure (the engine
 * rejected a write from a timer, E6) — a retry after RETRY_MS, no more than
 * MAX_RETRIES times in a row.
 */
async function flush($: EngineInterface): Promise<void> {
  isScheduled = false

  try {
    const stored = await read($, railAtom)

    if (isSeedPending) {
      isSeedPending = false
      seedRows(stored.bars)
    }

    if (!isSameRail(stored, composeRail(stored))) {
      await update($, railAtom, composeRail)
    }

    retries = 0
  } catch {
    if (retries < MAX_RETRIES) {
      retries++
      later($, RETRY_MS, () => {
        void flush($)
      })
    }
  }
}

/**
 * Read the transcript and write the rail with the new turns. A read after
 * whose start another one started or the feed changed (`generation`) is
 * not applied; a read that still sees the id of the closed feed
 * (`leaving`) is not applied either, but it is retried after RETRY_MS, no more
 * than MAX_RETRIES times in a row. A failed read — the rail stays as it was.
 * The session id is not the one the cache belongs to (the feed change was
 * not brought by `session.end`) — the same reset as on a feed change.
 * The turns of the previous read beyond the rewind point (`/rewind`) are gone
 * — their rows left the feed without an event and leave the cache
 * (`rewound`); there is no full reset: `invalidate` would bring back only the
 * mounted rows. A read started when a turn was already running, with the turn
 * not ended during the read, keeps its prompt: `withoutRunning` takes the turn
 * off so that an earlier row of the same text does not take it.
 */
async function refresh($: EngineInterface): Promise<void> {
  const ticket = ++generation
  const running = feed.runningTurn
  let id: string
  let messages: readonly SessionMessage[]

  try {
    id = await $.session.id()
    messages = await $.session.messages()
  } catch {
    return
  }

  if (ticket !== generation) {
    return
  }

  if (id === leaving) {
    if (rereads < MAX_RETRIES) {
      rereads++
      later($, RETRY_MS, () => {
        void refresh($)
      })
    }

    return
  }

  rereads = 0

  if (feed.session !== null && feed.session !== id) {
    reset($, null)
  }

  const turns = splitTurns(messages)
  const isStillRunning = running !== null && running === feed.runningTurn
  const latest = isStillRunning ? withoutRunning(turns, feed.startedKey) : turns

  for (const gone of rewound(feed.rows.values(), feed.turns, latest)) {
    dropRow(gone)
    feed.marks.delete(gone)
  }

  feed.session = id
  feed.turns = latest
  feed.isCapped = messages.length >= MESSAGES_MAX
  feed.isUnread = false
  leaving = null

  await flush($)
}

/**
 * The feed changed: a new feed cache (rows, removed rows, queue,
 * turns, flags) and a request to the engine to redraw the rows (`invalidate`).
 * `left` is the id of the feed that `session.end` closed: its rows that
 * the engine draws after the change (and those the cache removed itself) do
 * not go into the cache, and a read that still sees its id is not applied.
 * null — `refresh` saw the change: the rows of the new feed seen before
 * it will be brought back by `invalidate`. The written rail of another
 * feed does not seed the cache.
 */
function reset($: EngineInterface, left: string | null): void {
  generation++
  retired = left === null ? new Set() : new Set([...feed.rows.keys(), ...feed.dropped])
  leaving = left
  isSeedPending = false
  rereads = 0
  feed = { ...newFeed(), isUnread: true }
  $.ui.invalidate('ui.render')
}

/**
 * A turn of the main agent with text `text` has started. Rows replaced by rows
 * of waiting prompts (`replaced`) leave. If this is the turn of waiting
 * prompts (`startedKeys`: a prompt with its text, a slash command or prompts
 * merged by the engine into one), their keys leave `waiting`, their temporary
 * rows leave the cache (however many there are), and their rows after the end
 * of the previous turn are held until the end of this one. The row of the
 * turn's prompt (`isLive`) is the row of a waiting prompt with the turn's
 * text that came before `turn.start` (E5 log), even if the end of a
 * notification turn has already released it; for merged prompts — the newest
 * row with the turn's text seen after the end of the previous turn; there is
 * none — the first row with this key will become it (`awaitsRow`). A turn
 * that started none of the waiting prompts does not touch temporary rows:
 * `prompt.submit` removed a new submission of the same text from `waiting`,
 * and the row of the delivered prompt stays.
 *
 * @returns whether the rows changed
 */
function beginTurn(turnId: string, text: string): boolean {
  const key = textKey(text)
  const hadReplaced = feed.replaced.size > 0

  for (const id of feed.replaced) {
    dropRow(id)
  }

  feed.replaced.clear()
  feed.runningTurn = turnId
  feed.startedKey = key
  feed.awaitsRow = true
  feed.promptRow = null

  const landedOf = (typed: string) => feed.landed.get(typed) ?? typed
  const started = new Set(startedKeys(text, [...new Set([...feed.waiting.keys()].map(landedOf))]))

  if (started.size === 0) {
    return hadReplaced
  }

  const waited: Seen[] = []
  feed.isDraining = true

  for (const [typed, wait] of feed.waiting) {
    const landed = landedOf(typed)

    if (!started.has(landed)) {
      continue
    }

    feed.waiting.delete(typed)

    for (const [id, row] of feed.rows) {
      if (row.key === landed && row.isTurnless === true && row.since >= wait.endedAt) {
        dropRow(id)
      }
    }

    const row = wait.row === null ? undefined : feed.rows.get(wait.row)

    if (row !== undefined) {
      row.isHeld = true
      waited.push(row)
    }
  }

  const prompt = waited.find((row) => row.key === key) ?? newestSinceEnd(key)

  if (prompt !== undefined) {
    prompt.isHeld = true
    prompt.isLive = true
    feed.promptRow = prompt.id
    feed.awaitsRow = false
  }

  return true
}

/** The newest row with key `key` seen after the end of the previous turn, except turnless rows. */
function newestSinceEnd(key: string): Seen | undefined {
  let newest: Seen | undefined

  for (const row of feed.rows.values()) {
    const isCandidate = row.key === key && row.since === feed.ends && row.isTurnless !== true

    if (isCandidate && row.order > (newest?.order ?? -Infinity)) {
      newest = row
    }
  }

  return newest
}

/**
 * A turn of the main agent has ended. The flag of an end that is not an answer
 * (`reason`) is put on the row of the turn's prompt (`promptRow`); a
 * notification or slash-command turn has none. Rows that were held get bound.
 * The `queued` keys move to `waiting` and wait there for the start of their
 * turn, however many turns pass: the key of a prompt delivered into the turn
 * or taken out of the queue leaves with a submission while no turn is running,
 * and its row stays a turnless bar (they cannot be told apart, and the bar of
 * a real prompt must not be lost).
 */
function endTurn(reason: TurnCompleteReason, turnId: string): void {
  if (reason !== 'answer' && feed.promptRow !== null) {
    feed.marks.set(feed.promptRow, reason)
  }

  for (const row of feed.rows.values()) {
    row.isHeld = false
  }

  for (const key of feed.queued) {
    feed.waiting.set(key, { endedAt: feed.ends, row: null })
  }

  feed.queued.clear()
  feed.ends++
  feed.runningTurn = null
  feed.endedTurn = turnId
  feed.startedKey = null
  feed.awaitsRow = false
  feed.promptRow = null
}

/** A turn of the main agent, not of a subagent. */
function isMainLoop(e: { readonly agentId?: string }): boolean {
  return e.agentId === undefined
}

/**
 * Scroll the feed to the row of the prompt of bar `id` (the bar's
 * `onPress`, a command) and after a successful jump make the bar the reading
 * one (`current`) through a write of the rail (`flush`, with its retries). The
 * feed row moves only while the call answers a human action (E2). A
 * denial (`deny`) and a failed call do not change `current`; a failure is
 * returned as a denial with the error text, a denial is written to the debug
 * log (`note`).
 */
async function jump($: EngineInterface, id: string): Promise<UiScrollResult> {
  let result: UiScrollResult

  try {
    result = await $.ui.scroll(jumpArgs(id))
  } catch (err) {
    result = { deny: errorText(err) }
  }

  if (result.deny === undefined) {
    feed.reading = { kind: 'jump', id }
    await flush($)
  } else {
    note($, jumpNote(id, result.deny))
  }

  return result
}

/**
 * Register the mod's commands. All are `immediate`: the jump and the fold by a
 * key work while a turn is running too. A failed registration does not get in
 * the way of the rest of the startup work.
 */
async function registerCommands($: EngineInterface): Promise<void> {
  await Promise.allSettled([
    $.command.register({
      name: 'tail-feed',
      description: 'Tail feed: jump to a prompt, collapse or expand the rail, or help without arguments',
      argumentHint: COMMAND_HINT,
      immediate: true,
    }),
    $.command.register({
      name: 'tail-feed-next',
      description: 'Tail feed: jump to the next prompt',
      immediate: true,
    }),
    $.command.register({
      name: 'tail-feed-prev',
      description: 'Tail feed: jump to the previous prompt',
      immediate: true,
    }),
    $.command.register({
      name: 'tail-feed-toggle',
      description: 'Tail feed: collapse the rail to one line or expand it',
      immediate: true,
    }),
  ])
}

/**
 * Run a command of the mod: the target by the argument and the rail from
 * `$.state` (`aimCommand`), the jump (`jump`) or the fold (`toggleFold`) and
 * the reply: a successful jump and a successful fold — without text; a
 * denial, a failed fold, the help, "nothing to jump to" and a failed read of
 * the rail — as a line for the human only (`replyOf`). The fold does not read
 * the rail: a failed read of the rail does not get in its way.
 */
async function runCommand($: EngineInterface, name: string, args: string): Promise<CommandRunResult> {
  const command = parseCommand(commandArgs(name, args))
  let rail = EMPTY_RAIL

  if (command.kind !== 'toggle') {
    try {
      rail = await read($, railAtom)
    } catch (err) {
      return replyOf(`rail unavailable: ${errorText(err)}`)
    }
  }

  const aim = aimCommand(command, rail)

  switch (aim.kind) {
    case 'reply':
      return replyOf(aim.text)
    case 'toggle':
      return foldReply(await toggleFold($))
    case 'jump':
      return jumpReply(aim.n, await jump($, aim.id))
  }
}

export const register: Register = (on) => {
  feed = newFeed()
  nextOrder = 0
  leaving = null
  retired = new Set()
  generation = 0
  isSeedPending = true
  isScheduled = false
  retries = 0
  rereads = 0

  // The "Row render" flow: a human row goes into the cache (`observeRow`, the
  // write is deferred), and above the row of the prompt of the last jump
  // (`markParts`) — the mark `▸ #n/N · Kind` (`markLine`), under it the row as
  // is. Terminal only: rows of other surfaces would give bars the terminal
  // would not jump to. Outside fullscreen there are no jumps — the rail is not
  // read. Reading the rail redraws the row on each write of it; why this is not
  // a loop — `Feed.dropped`. The rail cannot be read — the row without a mark.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !isHumanRow(e.requestId, e.props.origin, e.props.text)) {
      return next(e)
    }

    if (observeRow(e.requestId, e.props.text)) {
      schedule($)
    }

    if (e.viewport?.isFullscreen === false) {
      return next(e)
    }

    const rail = await readRail($)
    const parts = rail === null ? null : markParts(rail)

    if (parts === null || parts.id !== e.requestId) {
      return next(e)
    }

    const ui = $.ui.resolve(e)

    return stacked(ui, markLine(ui, parts), await next(e))
  })

  // The strip's rail: only a terminal in fullscreen and the main feed;
  // yields to a survey. A strip collapsed by the engine gets the rail as is: the
  // engine hides it, and an empty strip it does not draw at all — and there
  // would be nothing to expand it from. A rail folded by its own button is one
  // line (`railRow`); whether it is folded cannot be read — unfolded. Reads
  // only the state, puts nothing in a queue; the rail cannot be read — yields.
  // A click on a bar — a jump, on the fold button — `toggleFold`. Under the
  // rail — what is lower in the chain (`next(e)`).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, view, bodyColumns } = e.props

    if (
      e.surface !== 'terminal' ||
      hasSurvey ||
      e.viewport?.isFullscreen === false ||
      view.agentId !== undefined
    ) {
      return next(e)
    }

    const rail = await readRail($)

    if (rail === null) {
      return next(e)
    }

    const folded = await readFolded($)
    const ui = $.ui.resolve(e)
    const row = railRow(
      ui,
      rail,
      bodyColumns,
      folded,
      (id) => {
        void jump($, id)
      },
      () => {
        void toggleFold($)
      },
    )

    if (row === null) {
      return next(e)
    }

    return stacked(ui, row, await next(e))
  })

  // A human prompt submitted during a turn (a turn of the main agent is running
  // or the engine named a turn the mod did not see end — a turn from before the
  // mod was loaded) is drawn under temporary ids: its key is in `queued` until
  // the end of the turn. A submission while no turn is running means the queue
  // is empty (`dropQueue`). A new submission of a text from `waiting` is not a
  // waiting prompt: the rows of the previous submission stay. A prompt rewritten
  // lower in the chain remembers the text that reached the session
  // (`noteLanded`). The hook only observes.
  on('prompt.submit', async ($, e, next) => {
    const isHuman = isHumanOrigin(e.origin)
    const typed = textKey(e.text)
    const from = nextOrder

    if (isHuman) {
      feed.waiting.delete(typed)

      if (feed.runningTurn !== null || (e.turnId !== undefined && e.turnId !== feed.endedTurn)) {
        feed.queued.add(typed)
      } else if (dropQueue()) {
        schedule($)
      }
    }

    const result = await next(e)

    if (isHuman && result.drop === undefined && noteLanded(typed, textKey(result.text), from)) {
      schedule($)
    }

    return result
  })

  // The start of a turn in the new feed means the feed change is
  // over. The start of a turn changes the rows of waiting prompts (`beginTurn`)
  // — the write is deferred.
  on('turn.start', ($, e, next) => {
    if (isMainLoop(e)) {
      leaving = null

      if (beginTurn(e.turnId, e.text)) {
        schedule($)
      }
    }

    return next(e)
  })

  // The end of a turn clears the turn before `next(e)`: the start of the next
  // turn that arrives while we wait does not lose its state. The end of another
  // turn (a different `turnId`) does not clear the turn. The transcript is read
  // on a failure lower in the chain too.
  on('turn.complete', async ($, e, next) => {
    if (isMainLoop(e) && (feed.runningTurn === null || feed.runningTurn === e.turnId)) {
      endTurn(e.reason, e.turnId)
    }

    try {
      return await next(e)
    } finally {
      if (isMainLoop(e)) {
        await refresh($)
      }
    }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await registerCommands($)
    await refresh($)

    return result
  })

  // Only this hook answers the mod's commands; other commands do not come here (the selector).
  on('command.run', { command: ['tail-feed', 'tail-feed-next', 'tail-feed-prev', 'tail-feed-toggle'] }, ($, e) =>
    runCommand($, e.command, e.args),
  )

  // `/clear` and `/resume` change the feed; there is no `session.start`
  // after them. The reset happens on a failure lower in the chain too.
  on('session.end', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.reason === 'clear' || e.reason === 'resume') {
        reset($, e.sessionId)
        await flush($)
      }
    }
  })
}
