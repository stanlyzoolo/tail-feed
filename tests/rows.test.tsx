import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAR_COLORS, BAR_TEXT_MAX, barText, isFlagged, KIND_COLORS, kindOf, summarize } from '../hooks/lib'
import type { Bar, RailState, TurnSummary } from '../types'
import {
  completeTurn,
  COMPOSER,
  deliver,
  draw,
  gateComplete,
  gateWrite,
  human,
  markOf,
  mountRow,
  newWorld,
  NOTIFICATION,
  render,
  reply,
  seedRail,
  stage,
  startTurn,
  submit,
  tool,
  VIEWPORT,
} from './world'
import type { Stage } from './world'

/** A bar without a summary (kind `unknown`). */
function bar(id: string, text: string): Bar {
  return { id, text, summary: null }
}

/** Summary of a turn that edited one file. */
const EDITED: TurnSummary = { tools: 2, edits: 1, agents: 0, skills: [], errors: 0, interrupted: false }

/** A rail written before the mod reload. */
function saved(fields: Partial<RailState>): RailState {
  return { bars: [], older: 0, current: null, ...fields }
}

/** Bar ids of the last rail write. */
function ids(rail: RailState | undefined): string[] | undefined {
  return rail?.bars.map((item) => item.id)
}

/** Rail bars as "id:kind"; `!` — an error or an interruption. */
function brief(rail: RailState | undefined): string[] {
  return (rail?.bars ?? []).map((item) => `${item.id}:${kindOf(item.summary)}${isFlagged(item.summary) ? '!' : ''}`)
}

/** The mark line as `markLine` draws it: `label` in the "you are here" color, the kind name in the kind color. */
function markTree(label: string, name: string, color: string): unknown {
  return {
    type: 'Text',
    props: { wrap: 'truncate-end' },
    children: [
      { type: 'Text', props: { color: BAR_COLORS.current }, children: [label] },
      { type: 'Text', props: { color }, children: [name] },
    ],
  }
}

/** The human typed the prompts `texts` while a turn runs: each waits under two temporary rows `<text>-tmp-<n>` (E5). */
async function queue($: Engine, rail: Stage, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await submit($, text)
    await draw($, rail, `${text}-tmp-1`, text)
    await draw($, rail, `${text}-tmp-2`, text)
  }
}

test('human rows give bars of kind unknown; foreign rows and placeholder do not', async ($, on) => {
  const world = newWorld('sess-rows')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'first prompt')
  await draw($, rail, 'r2', 'from the phone', { kind: 'bridge' })
  // A task notification, a subagent and a teammate message, a plugin prompt.
  await draw($, rail, 'n1', 'Agent "md files" finished', { kind: 'task-notification' })
  await draw($, rail, 'p1', 'message from another session', { kind: 'peer-send-message' })
  await draw($, rail, 't1', 'teammate message', { kind: 'unclassified' })
  await draw($, rail, 'g1', 'plugin prompt', { kind: 'plugin', name: 'other' })
  // A just-submitted prompt and a slash command before the real id (E1).
  await draw($, rail, 'placeholder', 'third prompt')
  await draw($, rail, 'e1', '   ')
  // The rail does not take a row on another surface: it is drawn only in the terminal.
  await draw($, rail, 'd1', 'from the desktop', { kind: 'composer' }, 'desktop')

  expect(rail.last()?.bars).toEqual([bar('r1', 'first prompt'), bar('r2', 'from the phone')])
  expect(rail.last()?.bars.map((item) => kindOf(item.summary))).toEqual(['unknown', 'unknown'])
  // No turns and no reads of the world: rows are only observed.
  expect(world.calls).toEqual({ sessionId: 0, messages: 0, set: 2, invalidate: 0 })
})

test('redrawing the same row does not write state', async ($, on) => {
  const world = newWorld('sess-again')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'hello')
  expect(world.calls.set).toBe(1)

  // Scrolling and a redraw of the same row (another `onScreen`, ctrl+o expansion).
  await draw($, rail, 'r1', 'hello')
  await $.ui.render({
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'r1',
    props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: true, onScreen: null },
  })
  await rail.clock.settle()

  expect(world.calls.set).toBe(1)
  expect(rail.all()).toHaveLength(1)
})

test('rows of one tick — one write', async ($, on) => {
  const world = newWorld('sess-tick')
  const rail = stage(on, world)

  // After a mod reload the engine redraws all rows at once (E1).
  await render($, 'r1', 'one')
  await render($, 'r2', 'two')
  await render($, 'r3', 'three')
  expect(world.calls.set).toBe(0)

  await rail.clock.settle()

  expect(world.calls.set).toBe(1)
  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('bar text — the paste block as a token, whitespace collapsed, no longer than BAR_TEXT_MAX', async ($, on) => {
  const world = newWorld('sess-text')
  const rail = stage(on, world)
  const pasted = '\n\n<pasted_content id="225b">\nPasted line 1\nPasted line 2\n</pasted_content id="225b">\n\nhow many lines?'
  const long = `[Image #2]  what   is in the picture?\n${'a very long prompt '.repeat(40)}`

  await draw($, rail, 'r1', pasted)
  await draw($, rail, 'r2', long)

  const [first, second] = rail.last()?.bars ?? []
  expect(first?.text).toBe('[Pasted text +2 lines] how many lines?')
  expect(second?.text).toBe(barText(long))
  expect(second?.text.startsWith('[Image #2] what is in the picture? a very')).toBe(true)
  expect([...(second?.text ?? '')]).toHaveLength(BAR_TEXT_MAX)
  expect(second?.text.endsWith('…')).toBe(true)
})

test('a prompt submitted during a turn: two temporary rows and the final one after the turn — one bar', async ($, on) => {
  const world = newWorld('sess-queued')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'first')
  await startTurn($, world, 'first')

  // Typed while the model answers: waits for the end of the turn under two temporary ids (E5).
  await submit($, 'second')
  await draw($, rail, 'tmp-1', 'second')
  expect(ids(rail.last())).toEqual(['r1', 'tmp-1'])
  await draw($, rail, 'tmp-2', 'second')
  expect(ids(rail.last())).toEqual(['r1', 'tmp-2'])

  // The order from the experiment log (E5): end of the turn, the final row, start of
  // the "second" turn — it removes the temporary row.
  await completeTurn($, world, rail)
  await draw($, rail, 'r2', 'second')
  await startTurn($, world, 'second')
  await rail.clock.settle()
  expect(rail.last()?.bars).toEqual([bar('r1', 'first'), bar('r2', 'second')])

  // The final row is not temporary: the same text submitted after the turn does
  // not erase its bar.
  await completeTurn($, world, rail)
  await submit($, 'second')
  await startTurn($, world, 'second')
  await draw($, rail, 'r3', 'second')

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('a prompt delivered into the running turn: temporary rows and the final one during the turn — one bar', async ($, on) => {
  const world = newWorld('sess-delivered')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'first')
  await startTurn($, world, 'first')
  await submit($, 'and this too')
  await draw($, rail, 'tmp-1', 'and this too')
  await draw($, rail, 'tmp-2', 'and this too')
  await draw($, rail, 'r2', 'and this too')
  await completeTurn($, world, rail)

  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  // The final row is not temporary: its bar survives the following turns, and the
  // same text submitted later does not erase it.
  await submit($, 'second')
  await startTurn($, world, 'second')
  await draw($, rail, 'r3', 'second')
  await completeTurn($, world, rail)
  await submit($, 'and this too')
  await startTurn($, world, 'and this too')
  await draw($, rail, 'r4', 'and this too')
  await completeTurn($, world, rail)

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3', 'r4'])
})

test('a prompt withdrawn from the queue leaves a bar without a turn: its temporary row cannot be told from one delivered into the turn', async ($, on) => {
  const world = newWorld('sess-withdrawn')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')

  // Typed during the turn and waiting; the human took it back into the prompt input
  // (up arrow), and the temporary rows vanished without an event.
  await submit($, 'draft')
  await draw($, rail, 'tmp-1', 'draft')
  await draw($, rail, 'tmp-2', 'draft')
  await completeTurn($, world, rail)
  expect(ids(rail.last())).toEqual(['r1', 'tmp-2'])

  // Another text is submitted: a turn and its end, then one more.
  for (const [id, text] of [['r2', 'corrected'], ['r3', 'more']] as const) {
    await submit($, text)
    await startTurn($, world, text)
    await draw($, rail, id, text)
    await completeTurn($, world, rail)
  }

  // The row of the withdrawn prompt is like the row of a prompt delivered into the
  // turn: the number of temporary rows is a rendering detail, and the bar of a real
  // prompt must not be lost. The bar stays, it has no turn.
  expect(rail.last()?.bars.map((item) => `${item.id}:${kindOf(item.summary)}`)).toEqual([
    'r1:unknown',
    'tmp-2:unknown',
    'r2:unknown',
    'r3:unknown',
  ])
})

test('a prompt that waited for the end of the turn while another turn ran next gets its bar in its own turn', async ($, on) => {
  const world = newWorld('sess-late')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'waiting')
  await draw($, rail, 'tmp-1', 'waiting')
  await draw($, rail, 'tmp-2', 'waiting')
  await completeTurn($, world, rail)

  // Before it — a task notification turn: the temporary row waits through it too.
  await startTurn($, world, '<task-notification>done</task-notification>')
  await completeTurn($, world, rail)
  expect(ids(rail.last())).toEqual(['r1', 'tmp-2'])

  await draw($, rail, 'r2', 'waiting')
  await startTurn($, world, 'waiting')
  await rail.clock.settle()

  expect(ids(rail.last())).toEqual(['r1', 'r2'])
})

test('three prompts typed during one turn each run as their own turn: a bar per prompt, the queue at the end of the rail', async ($, on) => {
  const world = newWorld('sess-queue-three')
  const rail = stage(on, world)

  await submit($, 'A')
  await startTurn($, world, 'A')
  await draw($, rail, 'rA', 'A')
  world.messages.push(human('A'), reply())
  await queue($, rail, 'B', 'C', 'D')
  await completeTurn($, world, rail)
  expect(ids(rail.last())).toEqual(['rA', 'B-tmp-2', 'C-tmp-2', 'D-tmp-2'])

  // Not verified live: the engine drains the queue one prompt per turn. Each has
  // its final row, then the start of its turn (E5 log); prompts that are still
  // waiting stand after the prompt of the running turn.
  const during: (string[] | undefined)[] = []

  for (const text of ['B', 'C', 'D']) {
    await draw($, rail, `r${text}`, text)
    await startTurn($, world, text)
    await rail.clock.settle()
    during.push(ids(rail.last()))
    world.messages.push(human(text), tool('Edit', { file_path: `/w/${text}.txt` }), reply())
    await completeTurn($, world, rail, text === 'D' ? 'error' : 'answer')
  }

  expect(during).toEqual([
    ['rA', 'rB', 'C-tmp-2', 'D-tmp-2'],
    ['rA', 'rB', 'rC', 'D-tmp-2'],
    ['rA', 'rB', 'rC', 'rD'],
  ])
  // The key of the last prompt waited three turns and was not lost: the error flag is on its bar.
  expect(brief(rail.last())).toEqual(['rA:talk', 'rB:edit', 'rC:edit', 'rD:edit!'])
})

test('two queued prompts run by the engine as one turn with the text of the first: a bar per prompt, no temporary rows left', async ($, on) => {
  const world = newWorld('sess-queue-merged')
  const rail = stage(on, world)

  await submit($, 'A')
  await startTurn($, world, 'A')
  await draw($, rail, 'rA', 'A')
  world.messages.push(human('A'), reply())
  await queue($, rail, 'B', 'C')
  await completeTurn($, world, rail)

  // Not verified live: both final rows, then one turn; the transcript holds both entries.
  await draw($, rail, 'rB', 'B')
  await draw($, rail, 'rC', 'C')
  await startTurn($, world, 'B')
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['rA', 'rB', 'rC'])

  world.messages.push(human('B'), human('C'), tool('Edit', { file_path: '/w/c.txt' }), reply())
  await completeTurn($, world, rail)
  await submit($, 'E')
  await startTurn($, world, 'E')
  await draw($, rail, 'rE', 'E')
  world.messages.push(human('E'), reply())
  await completeTurn($, world, rail)

  expect(brief(rail.last())).toEqual(['rA:talk', 'rB:talk', 'rC:edit', 'rE:talk'])
})

test('two queued prompts merged by the engine into one: one bar with the end-of-turn flag, no temporary rows left', async ($, on) => {
  const world = newWorld('sess-queue-joined')
  const rail = stage(on, world)
  const joined = 'fix README\nand run the tests'

  await submit($, 'A')
  await startTurn($, world, 'A')
  await draw($, rail, 'rA', 'A')
  world.messages.push(human('A'), reply())
  await queue($, rail, 'fix README', 'and run the tests')
  await completeTurn($, world, rail)

  // Not verified live: one final row with the text of both, then a turn with it.
  await draw($, rail, 'rJ', joined)
  await startTurn($, world, joined)
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['rA', 'rJ'])

  world.messages.push(human(joined), tool('Edit', { file_path: '/w/README.md' }), reply())
  await completeTurn($, world, rail, 'refusal')

  expect(brief(rail.last())).toEqual(['rA:talk', 'rJ:edit!'])
})

test('the second temporary row came after the end of the turn: the row of the turn prompt is the final one', async ($, on) => {
  const world = newWorld('sess-late-temp')
  const rail = stage(on, world)

  await startTurn($, world, 'yes')
  await draw($, rail, 'r0', 'yes')
  world.messages.push(human('yes'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)
  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')

  // "yes" is typed when the turn is almost over: the second temporary row (in the
  // experiment — 170 ms after the submit) is drawn after its end.
  await submit($, 'yes')
  await draw($, rail, 'tmp-1', 'yes')
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)
  await draw($, rail, 'tmp-2', 'yes')
  await draw($, rail, 'r2', 'yes')
  await startTurn($, world, 'yes')
  await rail.clock.settle()
  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:unknown'])

  world.messages.push(human('yes'), tool('Read'), reply())
  await completeTurn($, world, rail, 'error')

  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:work!'])
})

test('the final row of a waiting prompt came before the notification turn: the start of its turn makes it the prompt row', async ($, on) => {
  const world = newWorld('sess-before-notification')
  const rail = stage(on, world)

  await startTurn($, world, 'yes')
  await draw($, rail, 'r0', 'yes')
  world.messages.push(human('yes'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)
  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'yes')
  await draw($, rail, 'tmp-1', 'yes')
  await draw($, rail, 'tmp-2', 'yes')
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)

  // Not verified live: the final row, the notification turn, then the "yes" turn.
  await draw($, rail, 'r2', 'yes')
  await startTurn($, world, NOTIFICATION)
  world.messages.push(human(NOTIFICATION), reply())
  await completeTurn($, world, rail)
  await startTurn($, world, 'yes')
  await rail.clock.settle()
  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:unknown'])

  world.messages.push(human('yes'), tool('Read'), reply())
  await completeTurn($, world, rail, 'aborted')

  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:work!'])
})

test('a queued prompt rewritten by a hook further down the chain: temporary rows go, the bar takes the turn of the rewritten text', async ($, on) => {
  const world = newWorld('sess-queue-rewrite')
  const rail = stage(on, world)
  const landed = 'fix the note\n\n(answer briefly)'

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  world.rewrite = () => landed
  await queue($, rail, 'fix the note')
  await completeTurn($, world, rail)
  await draw($, rail, 'r2', 'fix the note')
  await startTurn($, world, landed)
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  world.messages.push(human(landed), tool('Edit', { file_path: '/w/note.md' }), reply())
  await completeTurn($, world, rail, 'error')

  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:edit!'])
})

test('a queued slash command: its temporary rows go when its turn starts', async ($, on) => {
  const world = newWorld('sess-queue-command')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  // Not verified live whether the queue draws a command with temporary rows.
  await queue($, rail, '/workflow:clarify why so')
  await completeTurn($, world, rail)
  const command =
    '<command-message>workflow:clarify</command-message>\n<command-name>/workflow:clarify</command-name>\n<command-args>why so</command-args>'
  await startTurn($, world, command)
  await rail.clock.settle()

  expect(ids(rail.last())).toEqual(['r1'])
})

test('the turn started before the mod loaded: a prompt typed over it (turnId) is still temporary', async ($, on) => {
  const world = newWorld('sess-reloaded')
  const rail = stage(on, world)

  // The mod did not see `turn.start`: the turn is named only in `prompt.submit`.
  await submit($, 'follow-up', { kind: 'composer' }, 'turn-before-reload')
  await draw($, rail, 'tmp-1', 'follow-up')
  await draw($, rail, 'tmp-2', 'follow-up')
  expect(ids(rail.last())).toEqual(['tmp-2'])

  await completeTurn($, world, rail)
  await startTurn($, world, 'follow-up')
  await draw($, rail, 'r1', 'follow-up')

  expect(ids(rail.last())).toEqual(['r1'])
})

test('the same prompt repeated does not erase the earlier bar — after the end of the turn and during the next one', async ($, on) => {
  const world = newWorld('sess-same')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'yes')
  await startTurn($, world, 'yes')
  await completeTurn($, world, rail)

  // The same text after the end of the turn: an ordinary row.
  await submit($, 'yes')
  await draw($, rail, 'r2', 'yes')
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  // The same text during the "yes" turn: temporary rows do not touch rows seen before them.
  await startTurn($, world, 'yes')
  await draw($, rail, 'r3', 'yes')
  await submit($, 'yes')
  await draw($, rail, 'tmp-1', 'yes')
  await draw($, rail, 'tmp-2', 'yes')

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3', 'tmp-2'])
})

test('a notification, plugin or other-session prompt during a turn does not make a human row with the same text temporary', async ($, on) => {
  const world = newWorld('sess-origin', [human('yes'), reply()])
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'yes', { kind: 'task-notification' })
  await submit($, 'yes', { kind: 'plugin', name: 'other' })
  await submit($, 'yes', { kind: 'peer' })
  // Scrolling up drew an old "yes" row with the same text.
  await draw($, rail, 'r0', 'yes')
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)

  // Row r0 is not a temporary queue row: the next turn does not remove it.
  await startTurn($, world, 'second')
  await draw($, rail, 'r2', 'second')
  world.messages.push(human('second'), reply())
  await completeTurn($, world, rail)

  expect(ids(rail.last())).toEqual(['r0', 'r1', 'r2'])
})

test('a prompt via Remote Control during a turn waits in the queue, like one from the prompt input', async ($, on) => {
  const world = newWorld('sess-bridge')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'from the phone', { kind: 'bridge' })
  await draw($, rail, 'tmp-1', 'from the phone', { kind: 'bridge' })
  await draw($, rail, 'tmp-2', 'from the phone', { kind: 'bridge' })
  await completeTurn($, world, rail)
  await startTurn($, world, 'from the phone')
  await draw($, rail, 'r2', 'from the phone', { kind: 'bridge' })

  expect(ids(rail.last())).toEqual(['r1', 'r2'])
})

test('the end of a subagent turn does not end the main agent turn and does not flag the bar', async ($, on) => {
  const world = newWorld('sess-sub-end')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'second')
  await draw($, rail, 'tmp-1', 'second')

  // A background subagent ended with an error in the middle of the main turn.
  await $.turn.complete({ agentId: 'agent-1', reason: 'error', answer: '', durationMs: 1, isAborted: false, turnId: 'turn-sub' })
  await rail.clock.settle()

  await draw($, rail, 'tmp-2', 'second')
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)
  await startTurn($, world, 'second')
  await draw($, rail, 'r2', 'second')

  expect(ids(rail.last())).toEqual(['r1', 'r2'])
  expect(rail.last()?.bars[0]?.summary?.errors).toBe(0)
})

test('race: the next turn started while the end of the previous one waits further down the chain — it loses nothing of its own', async ($, on) => {
  const world = newWorld('sess-turn-race', [human('yes'), tool('Edit', { file_path: '/w/a.txt' }), reply()])
  const rail = stage(on, world)
  const gate = gateComplete(world)

  await render($, 'r0', 'yes')
  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await submit($, 'yes')
  await draw($, rail, 'tmp-1', 'yes')
  await draw($, rail, 'tmp-2', 'yes')
  world.messages.push(human('first'), reply())

  // The end of the "first" turn waits for `next(e)`, while the waiting "yes" already
  // went in the order from the experiment log (E5): the final row, then the start of
  // its turn. The transcript read at the end of "first" already holds the prompt of
  // the running turn.
  gate.arm()
  const completed = completeTurn($, world, rail)
  await gate.reached
  await draw($, rail, 'r2', 'yes')
  await startTurn($, world, 'yes')
  world.messages.push(human('yes'))
  gate.release()
  await completed

  // The "yes" row of this turn is the prompt of the running turn: it does not take
  // the summary of the previous "yes", and the previous "yes" does not give up its turn.
  expect(rail.last()?.bars.map((item) => `${item.id}:${kindOf(item.summary)}`)).toEqual([
    'r0:edit',
    'r1:talk',
    'r2:unknown',
  ])
  expect(rail.last()?.older).toBe(0)
})

test('a prompt delivered into the turn after one temporary row: the final row stays a bar', async ($, on) => {
  const world = newWorld('sess-one-temp')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  await submit($, 'follow-up')
  await draw($, rail, 'tmp-1', 'follow-up')
  await draw($, rail, 'r2', 'follow-up')
  await completeTurn($, world, rail)

  for (const [id, text] of [['r3', 'second'], ['r4', 'third']] as const) {
    await submit($, text)
    await startTurn($, world, text)
    await draw($, rail, id, text)
    world.messages.push(human(text), reply())
    await completeTurn($, world, rail)
  }

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3', 'r4'])
})

test('a waiting prompt under three temporary rows: from the start of its turn — one bar', async ($, on) => {
  const world = newWorld('sess-three-temps')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  await submit($, 'waits')
  await draw($, rail, 'tmp-1', 'waits')
  await draw($, rail, 'tmp-2', 'waits')
  await draw($, rail, 'tmp-3', 'waits')
  await completeTurn($, world, rail)
  await draw($, rail, 'r2', 'waits')
  await startTurn($, world, 'waits')
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  world.messages.push(human('waits'), reply())
  await completeTurn($, world, rail)
  await submit($, 'third')
  await startTurn($, world, 'third')
  await draw($, rail, 'r3', 'third')

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('a prompt typed over a turn that is already over (turnId of the previous turn) is the prompt of its own turn', async ($, on) => {
  const world = newWorld('sess-late-submit')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  const over = world.turnId ?? ''
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)

  // The `prompt.submit` hook reached the mod when the turn the prompt was typed over had already ended.
  await submit($, 'late', { kind: 'composer' }, over)
  await startTurn($, world, 'late')
  await draw($, rail, 'r2', 'late')
  world.messages.push(human('late'), reply())
  await completeTurn($, world, rail)
  await submit($, 'third')
  await startTurn($, world, 'third')
  await draw($, rail, 'r3', 'third')
  world.messages.push(human('third'), reply())
  await completeTurn($, world, rail)

  expect(rail.last()?.bars.map((item) => `${item.id}:${kindOf(item.summary)}`)).toEqual(['r1:talk', 'r2:talk', 'r3:talk'])
})

test('a prompt rewritten by a hook further down the chain binds to the turn with the rewritten text', async ($, on) => {
  const world = newWorld('sess-rewrite')
  const rail = stage(on, world)
  const landed = 'fix the note\n\n(answer briefly)'
  world.rewrite = () => landed

  await submit($, 'fix the note')
  await startTurn($, world, landed)
  await draw($, rail, 'r1', 'fix the note')
  world.messages.push(human(landed), reply())
  await completeTurn($, world, rail)

  expect(rail.last()?.bars).toEqual([{ id: 'r1', text: 'fix the note', summary: summarize([]) }])
})

test('the clock.after hook denied the deferred write: the next write clears the stuck timer', {
  plugins: [
    {
      name: 'clock-refuser',
      register(on) {
        let calls = 0

        on('clock.after', (_, e, next) => (calls++ === 0 ? { deny: 'not now' } : next(e)))
      },
    },
  ],
}, async ($, on) => {
  const world = newWorld('sess-lost-timer')
  const rail = stage(on, world)

  // The timer of the first row will never fire, and the second row does not set a new one.
  await draw($, rail, 'r1', 'first')
  await draw($, rail, 'r2', 'second')
  expect(world.calls.set).toBe(0)

  // The end of the turn writes the rail and clears the stuck timer.
  await completeTurn($, world, rail)
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  await draw($, rail, 'r3', 'third')
  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('a prompt submitted during a subagent turn is an ordinary row', async ($, on) => {
  const world = newWorld('sess-subagent')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'run an agent in the background')
  // The main turn is over, only the subagent works: the submit starts a new turn.
  await startTurn($, world, 'run an agent in the background')
  await completeTurn($, world, rail)
  await startTurn($, world, 'agent task', 'agent-1')

  await submit($, 'ok')
  await draw($, rail, 'r2', 'ok')
  await draw($, rail, 'r3', 'ok')

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('a submitted prompt resets current, a redraw of rows does not; a summary written before the reload stays', async ($, on) => {
  // Before the mod reload: a jump to bar r1, it has a summary.
  seedRail(on, saved({ bars: [{ id: 'r1', text: 'edit', summary: EDITED }, bar('r2', 'question')], current: 'r1' }))
  const world = newWorld('sess-saved')
  const rail = stage(on, world)
  // The engine redraws rows after the reload (E1): the rail is the same, no write.
  await render($, 'r1', 'edit')
  await draw($, rail, 'r2', 'question')
  expect(world.calls.set).toBe(0)
  expect(rail.last()).toBeUndefined()

  // A submitted prompt: the row gets its real id after the turn starts (E1).
  await startTurn($, world, 'new prompt')
  await draw($, rail, 'r3', 'new prompt')

  expect(rail.last()).toEqual(
    saved({ bars: [{ id: 'r1', text: 'edit', summary: EDITED }, bar('r2', 'question'), bar('r3', 'new prompt')] }),
  )
})

test('a rail of another mod version (another shape tag) reads as empty', async ($, on) => {
  seedRail(on, saved({ bars: [{ id: 'r1', text: 'edit', summary: EDITED }], current: 'r1' }), 'rail-0')
  const world = newWorld('sess-old')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'edit')

  expect(rail.last()).toEqual({ bars: [bar('r1', 'edit')], older: 0, current: null })
})

test('a write is delayed: the next ones are not lost, the fresh value is written last', async ($, on) => {
  const world = newWorld('sess-race')
  const rail = stage(on, world)
  const gate = gateWrite(on)

  // The first write waits on `state.set`.
  gate.arm()
  await render($, 'r1', 'one')
  await rail.clock.settle()
  await gate.reached

  // While it waits, two more rows are drawn: their writes land earlier.
  await render($, 'r2', 'two')
  await rail.clock.settle()
  await render($, 'r3', 'three')
  await rail.clock.settle()

  // The delayed write misses the version, is recomputed from what was written
  // and does not overwrite the new rows.
  gate.release()
  await rail.clock.settle()

  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

test('the engine denied a write from the timer: a retry after 50 ms, the bars are written', async ($, on) => {
  seedRail(on, saved({ bars: [bar('r0', 'zero')], current: 'r0' }))
  const world = newWorld('sess-denied')
  const rail = stage(on, world)

  world.deniedWrites = 1
  await startTurn($, world, 'one')
  await draw($, rail, 'r1', 'one')
  expect(world.calls.set).toBe(1)
  expect(rail.last()).toBeUndefined()

  await rail.clock.advance(49)
  expect(world.calls.set).toBe(1)

  await rail.clock.advance(1)
  expect(world.calls.set).toBe(2)
  // Bar r0, written before the reload, stays: the engine may not have redrawn its row.
  expect(rail.last()?.bars).toEqual([bar('r0', 'zero'), bar('r1', 'one')])
  // A denied write does not lose the submitted-prompt flag: the reading bar is the newest again.
  expect(rail.last()?.current).toBeNull()
})

test('a retry of a denied write when another write already stored the rail writes nothing', async ($, on) => {
  const world = newWorld('sess-denied-twice')
  const rail = stage(on, world)

  world.deniedWrites = 1
  await draw($, rail, 'r1', 'one')
  // A new row is drawn before the retry: its write lands with both rows.
  await draw($, rail, 'r2', 'two')
  expect(world.calls.set).toBe(2)
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  // The retry compares with what was read from the state: nothing to write.
  await rail.clock.advance(50)

  expect(world.calls.set).toBe(2)
  expect(rail.all()).toHaveLength(1)
})

test('writes are denied in a row: retries run out, the next row writes everything', async ($, on) => {
  const world = newWorld('sess-denied-long')
  const rail = stage(on, world)

  world.deniedWrites = 1000
  await draw($, rail, 'r1', 'one')
  await rail.clock.advance(5000)

  // The first attempt and 20 retries, and that is all.
  expect(world.calls.set).toBe(21)
  await rail.clock.advance(5000)
  expect(world.calls.set).toBe(21)

  world.deniedWrites = 0
  await draw($, rail, 'r2', 'two')
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  // A successful write restores the retries: the next denial is retried again.
  world.deniedWrites = 1
  await draw($, rail, 'r3', 'three')
  expect(ids(rail.last())).toEqual(['r1', 'r2'])
  await rail.clock.advance(50)
  expect(ids(rail.last())).toEqual(['r1', 'r2', 'r3'])
})

/** A rail with a jump to bar r2 (`edit`) out of three, written before the mod reload. */
const JUMPED = saved({ bars: [bar('r1', 'one'), { id: 'r2', text: 'edit', summary: EDITED }, bar('r3', 'three')], current: 'r2' })

/**
 * The engine redrew the rows of the JUMPED rail in feed order, as after a mod
 * reload (E1): the cache matched the written rail, no write.
 */
async function redrawJumped($: Engine, rail: Stage): Promise<void> {
  for (const item of JUMPED.bars) {
    await render($, item.id, item.text)
  }

  await rail.clock.settle()
}

test('the mark above the prompt row of the last jump: ▸ #n/N · kind in the "you are here" color and in the kind color, the row as is beneath it; other rows have no mark', async ($, on) => {
  let seeded = JUMPED
  seedRail(on, () => seeded)
  const world = newWorld('sess-mark')
  const rail = stage(on, world)
  await redrawJumped($, rail)

  const jumped = await mountRow($, 'r2', 'edit')
  const tree = (await jumped.drawn()) as { type: string; props?: Record<string, unknown>; children?: unknown[] }
  expect(tree.type).toBe('Box')
  expect(tree.props?.flexDirection).toBe('column')
  expect(tree.children).toHaveLength(2)
  expect(tree.children?.[0]).toEqual(markTree('▸ #2/3 · ', 'Edit', KIND_COLORS.edit))
  expect((await markOf(jumped))?.text).toBe('▸ #2/3 · Edit')
  // Beneath the mark — the row as the engine draws it.
  expect(await jumped.keepsBeneath()).toBe(true)
  await jumped.unmount()

  for (const [id, text] of [['r1', 'one'], ['r3', 'three']] as const) {
    const other = await mountRow($, id, text)
    expect(await markOf(other)).toBeUndefined()
    expect(await other.keepsBeneath()).toBe(true)
    await other.unmount()
  }

  // A jump to the first and to the last bar: the number by the rail, the kind — by the bar summary.
  for (const [current, text, mark] of [['r1', 'one', '▸ #1/3 · Unknown'], ['r3', 'three', '▸ #3/3 · Unknown']] as const) {
    seeded = { ...JUMPED, current }
    const ui = await mountRow($, current, text)
    expect((await markOf(ui))?.text).toBe(mark)
    await ui.unmount()
  }

  // The mark only reads the rail: no writes.
  await rail.clock.settle()
  expect(world.calls.set).toBe(0)
})

test('no mark: without a jump, on desktop, outside fullscreen, the rail cannot be read', async ($, on) => {
  let seeded = saved({ ...JUMPED, current: null })
  seedRail(on, () => seeded)
  const world = newWorld('sess-no-mark')
  const rail = stage(on, world)
  await redrawJumped($, rail)

  // Without a jump: the reading bar is the newest one, but only a jump gets a mark.
  for (const item of JUMPED.bars) {
    const ui = await mountRow($, item.id, item.text)
    expect(await markOf(ui)).toBeUndefined()
    await ui.unmount()
  }

  seeded = JUMPED
  const shown = await mountRow($, 'r2', 'edit')
  expect((await markOf(shown))?.text).toBe('▸ #2/3 · Edit')
  await shown.unmount()

  // The rail does not take rows of other surfaces, outside fullscreen there are no jumps.
  for (const ui of [
    await mountRow($, 'r2', 'edit', COMPOSER, 'desktop'),
    await mountRow($, 'r2', 'edit', COMPOSER, 'terminal', { ...VIEWPORT, isFullscreen: false }),
  ]) {
    expect(await markOf(ui)).toBeUndefined()
    expect(await ui.keepsBeneath()).toBe(true)
    await ui.unmount()
  }

  // The rail read fails: the row as is, without a mark, not an empty one.
  world.isStateBroken = true
  const broken = await mountRow($, 'r2', 'edit')
  expect(await markOf(broken)).toBeUndefined()
  expect(await broken.keepsBeneath()).toBe(true)
  await broken.unmount()
})

test('a new prompt removes the mark: the submit resets current, and the rail write redraws the row with the mark', async ($, on) => {
  seedRail(on, JUMPED)
  const world = newWorld('sess-mark-reset')
  const rail = stage(on, world)
  await redrawJumped($, rail)

  const ui = await mountRow($, 'r2', 'edit')
  expect((await markOf(ui))?.text).toBe('▸ #2/3 · Edit')

  await startTurn($, world, 'new')
  await draw($, rail, 'r4', 'new')
  expect(rail.last()?.current).toBeNull()

  // The harness, like the engine, redraws a row that read the rail after its
  // write: no `redraw` needed.
  expect(await markOf(ui)).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()

  const fresh = await mountRow($, 'r4', 'new')
  expect(await markOf(fresh)).toBeUndefined()
  await fresh.unmount()
})

test('a redraw of a row that the cache dropped itself does not change the rail and schedules no write', async ($, on) => {
  const world = newWorld('sess-dropped')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  // tmp-2 replaces tmp-1 in the turn of the submit; the final r2 replaces tmp-2,
  // and the start of the "second" turn removes it (E5).
  await submit($, 'second')
  await draw($, rail, 'tmp-1', 'second')
  await draw($, rail, 'tmp-2', 'second')
  await completeTurn($, world, rail)
  await draw($, rail, 'r2', 'second')
  await startTurn($, world, 'second')
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['r1', 'r2'])
  const sets = world.calls.set

  // A redraw of dropped rows (a rail write redraws the rows that read it): they
  // do not return to the cache.
  await draw($, rail, 'tmp-1', 'second')
  await draw($, rail, 'tmp-2', 'second')
  const again = await mountRow($, 'tmp-2', 'second')
  await rail.clock.settle()
  await again.unmount()

  expect(world.calls.set).toBe(sets)
  expect(ids(rail.last())).toEqual(['r1', 'r2'])

  // The "second" turn is over: the dropped rows never came back.
  world.messages.push(human('second'), reply())
  await completeTurn($, world, rail)
  await draw($, rail, 'tmp-1', 'second')
  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:talk'])
})

test('two identical prompts delivered into one turn, and a redraw of both rows on every write — the rail does not move', async ($, on) => {
  const world = newWorld('sess-twice-delivered')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  await deliver($, rail, 'r2', 'follow-up')
  await deliver($, rail, 'r3', 'follow-up')
  // Both without a turn and with the same text: the row of the second replaced the row of the first.
  expect(ids(rail.last())).toEqual(['r1', 'r3'])

  // Both rows are on screen and read the rail: a rail write redraws both.
  const first = await mountRow($, 'r2', 'follow-up')
  const second = await mountRow($, 'r3', 'follow-up')
  await rail.clock.settle()
  const sets = world.calls.set
  expect(ids(rail.last())).toEqual(['r1', 'r3'])

  // The end of the turn writes the rail with the summary of "first" once: the
  // redrawn r2 does not return to the cache and does not drop r3 — there is no
  // "write → redraw → replace → write" loop.
  world.messages.push(human('first'), reply())
  await completeTurn($, world, rail)
  await rail.clock.advance(1000)

  expect(world.calls.set).toBe(sets + 1)
  expect(brief(rail.last())).toEqual(['r1:talk', 'r3:unknown'])
  await first.unmount()
  await second.unmount()
})

test('the start of its turn removed the temporary row of a waiting prompt before the final one: redrawn, it does not become the row of the turn prompt', async ($, on) => {
  const world = newWorld('sess-dropped-temp')
  const rail = stage(on, world)

  await startTurn($, world, 'first')
  await draw($, rail, 'r1', 'first')
  world.messages.push(human('first'), reply())
  await submit($, 'second')
  await draw($, rail, 'tmp-1', 'second')
  await completeTurn($, world, rail)
  // The "second" turn started before the final row: it removes the temporary
  // row (`beginTurn`), and the first new row with its text (`awaitsRow`) becomes
  // the row of the turn prompt.
  await startTurn($, world, 'second')
  await rail.clock.settle()
  expect(ids(rail.last())).toEqual(['r1'])
  const sets = world.calls.set

  // The temporary row is still on screen, and the rail write redrew it: it does
  // not return to the cache, schedules no write and does not take the turn prompt row.
  await draw($, rail, 'tmp-1', 'second')
  expect(world.calls.set).toBe(sets)

  await draw($, rail, 'r2', 'second')
  world.messages.push(human('second'), reply())
  await completeTurn($, world, rail)

  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:talk'])
})

test('a row outside fullscreen is a bar too: the hook takes the row into the cache before it yields without a mark', async ($, on) => {
  const world = newWorld('sess-not-fullscreen')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'one')

  // The main screen: no jumps, the hook does not read the rail, but the row is a feed prompt.
  const ui = await mountRow($, 'r2', 'two', COMPOSER, 'terminal', { ...VIEWPORT, isFullscreen: false })
  await rail.clock.settle()

  expect(ids(rail.last())).toEqual(['r1', 'r2'])
  expect(await markOf(ui)).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('a new row mounted for the first time: one rail write, and the redraw of the row by that write does not touch the rail', async ($, on) => {
  let renders = 0
  on('ui.render', { component: 'UserMessage' }, (_, e, next) => {
    renders += e.requestId === 'r2' ? 1 : 0

    return next(e)
  })
  const world = newWorld('sess-fresh-mount')
  const rail = stage(on, world)

  await draw($, rail, 'r1', 'one')
  const sets = world.calls.set

  // The render puts the row into the cache and schedules a write; the write of the
  // rail the row read redraws the row itself — the row is already known.
  const ui = await mountRow($, 'r2', 'two')
  await rail.clock.advance(1000)

  expect(renders).toBeGreaterThanOrEqual(2)
  expect(world.calls.set).toBe(sets + 1)
  expect(ids(rail.last())).toEqual(['r1', 'r2'])
  expect(await markOf(ui)).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('seeding from the written rail does not bring back a row that the cache dropped before the first write after the reload', async ($, on) => {
  // Before the reload d1 is the bar of a prompt delivered into the turn.
  seedRail(on, saved({ bars: [{ id: 'r1', text: 'first', summary: EDITED }, bar('d1', 'follow-up')] }))
  const world = newWorld('sess-seed-dropped', [human('first'), tool('Edit', { file_path: '/w/a.txt' }), reply()])
  const rail = stage(on, world)

  // After the reload, before the first write: a turn runs, the same text is
  // delivered into it again. Row d1 is drawn, row d2 of the new prompt replaces it
  // (`isTurnless`) — d1 is dropped.
  await startTurn($, world, 'second')
  await submit($, 'follow-up')
  await render($, 'd1', 'follow-up')
  await render($, 'd2', 'follow-up')
  await rail.clock.settle()

  // The first write seeds the cache from the written rail, but not the dropped row.
  expect(ids(rail.last())).toEqual(['r1', 'd2'])
})
