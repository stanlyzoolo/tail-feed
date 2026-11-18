import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { barText, isFlagged, kindOf, MESSAGES_MAX } from '../hooks/lib'
import type { RailState } from '../types'
import {
  changeSession,
  COMPACT_COMMAND,
  COMPACT_STDOUT,
  COMPACT_SUMMARY,
  completeTurn,
  deliver,
  draw,
  gateMessages,
  human,
  INTERRUPTED,
  INTERRUPTED_FOR_TOOL,
  newWorld,
  NOTIFICATION,
  render,
  reply,
  seedRail,
  stage,
  startSession,
  startTurn,
  submit,
  summary,
  tool,
} from './world'
import type { Stage, World } from './world'

/** The rail's bars as "id:kind", `!` — an error or an interruption: shorter to compare. */
function brief(rail: RailState | undefined): string[] {
  return (rail?.bars ?? []).map((bar) => `${bar.id}:${kindOf(bar.summary)}${isFlagged(bar.summary) ? '!' : ''}`)
}

/** The human submitted a prompt: the turn started, the row got its real id (E1). */
async function send($: Engine, world: World, rail: Stage, id: string, text: string): Promise<void> {
  await startTurn($, world, text)
  await draw($, rail, id, text)
}

/** A turn with a text answer: the prompt, the submit, the transcript record and the end of the turn. */
async function talk($: Engine, world: World, rail: Stage, id: string, text: string): Promise<void> {
  await send($, world, rail, id, text)
  world.messages.push(human(text), reply())
  await completeTurn($, world, rail)
}

test('after claude --resume the rows drawn by scrolling during a turn stand by their turns, not at the end of the rail', async ($, on) => {
  const numbers = [8, 9, 10, 11, 12]
  const world = newWorld('sess-scroll', numbers.flatMap((n) => [human(`prompt ${n}`), reply()]))
  const rail = stage(on, world)

  await render($, 'r12', 'prompt 12')
  await render($, 'r11', 'prompt 11')
  await render($, 'r10', 'prompt 10')
  await startSession($, rail)

  // R13 is submitted; while its turn runs, scrolling up draws R9 and R8.
  await send($, world, rail, 'r13', 'prompt 13')
  await draw($, rail, 'r9', 'prompt 9')
  await draw($, rail, 'r8', 'prompt 8')

  expect(brief(rail.last())).toEqual(['r8:talk', 'r9:talk', 'r10:talk', 'r11:talk', 'r12:talk', 'r13:unknown'])
  expect(rail.last()?.older).toBe(0)
})

test('the summary appears after the end of the turn; while the turn runs the bar is unknown', async ($, on) => {
  const world = newWorld('sess-summary')
  const rail = stage(on, world)

  await startSession($, rail)
  await send($, world, rail, 'r1', 'fix the note')
  world.messages.push(human('fix the note'), tool('Edit', { file_path: '/w/note.txt' }), reply('done'))
  expect(brief(rail.last())).toEqual(['r1:unknown'])

  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['r1:edit'])

  // The next turn is running: the previous bar has its summary, the new one is unknown.
  await send($, world, rail, 'r2', 'and now just answer')
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:unknown'])

  world.messages.push(human('and now just answer'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk'])
})

test('an interrupted turn is flagged: by the transcript record and by reason aborted when there is no record', async ($, on) => {
  const world = newWorld('sess-aborted')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'write an essay')
  world.messages.push(human('write an essay'), reply('Terminals…'), human(INTERRUPTED))
  await completeTurn($, world, rail, 'aborted')

  // Esc before the first word: the transcript has only the prompt.
  await send($, world, rail, 'r2', 'one more essay')
  world.messages.push(human('one more essay'))
  await completeTurn($, world, rail, 'aborted')

  expect(brief(rail.last())).toEqual(['r1:talk!', 'r2:talk!'])
  expect(rail.last()?.bars.map((bar) => bar.summary?.interrupted)).toEqual([true, true])
  expect(rail.last()?.bars.map((bar) => bar.summary?.errors)).toEqual([0, 0])
})

test('a denied permission is flagged by the transcript, though turn.complete is answer', async ($, on) => {
  const world = newWorld('sess-denied-tool')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'delete the draft')
  world.messages.push(human('delete the draft'), tool('Bash', { command: 'rm draft.txt' }, true), human(INTERRUPTED_FOR_TOOL))
  await completeTurn($, world, rail, 'answer')

  expect(brief(rail.last())).toEqual(['r1:work!'])
  expect(rail.last()?.bars[0]?.summary).toMatchObject({ tools: 1, errors: 1, interrupted: true })
})

test('a repeat of the same text is interrupted: only the bar of the repeat is flagged', async ($, on) => {
  const world = newWorld('sess-same-abort')
  const rail = stage(on, world)

  await talk($, world, rail, 'r1', 'continue')
  await send($, world, rail, 'r2', 'continue')
  world.messages.push(human('continue'))
  await completeTurn($, world, rail, 'error')

  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:talk!'])
})

test('a turn cut short by an API error or a model refusal is flagged, and the flag survives the next reads', async ($, on) => {
  const world = newWorld('sess-error')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'first')
  world.messages.push(human('first'))
  await completeTurn($, world, rail, 'error')
  expect(brief(rail.last())).toEqual(['r1:talk!'])

  await send($, world, rail, 'r2', 'second')
  world.messages.push(human('second'), reply())
  await completeTurn($, world, rail, 'refusal')

  await talk($, world, rail, 'r3', 'third')

  // The transcript carries no errors: the flag from turn.complete landed on the bar's summary.
  expect(brief(rail.last())).toEqual(['r1:talk!', 'r2:talk!', 'r3:talk'])
  expect(rail.last()?.bars.map((bar) => bar.summary?.errors)).toEqual([1, 1, 0])
})

test('a turn started by a task notification does not flag a bar', async ($, on) => {
  const world = newWorld('sess-notification')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'run an agent in the background')
  world.messages.push(human('run an agent in the background'), tool('Agent', { prompt: 'md files' }), reply('started'))
  await completeTurn($, world, rail)

  // The agent finished: the notification starts a turn of the main agent, and that turn is cut short.
  await startTurn($, world, NOTIFICATION)
  await draw($, rail, 'n1', 'Agent "md files" finished', { kind: 'task-notification' })
  world.messages.push(human(NOTIFICATION), reply('the agent found two files'))
  await completeTurn($, world, rail, 'error')

  expect(brief(rail.last())).toEqual(['r1:agent'])
})

test('a session.messages failure keeps the previous rail; the next read catches up', async ($, on) => {
  const world = newWorld('sess-broken')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'fix it')
  world.messages.push(human('fix it'), tool('Write', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)

  await send($, world, rail, 'r2', 'second')
  world.messages.push(human('second'), reply())
  world.isMessagesBroken = true
  const written = rail.all().length

  await completeTurn($, world, rail)
  expect(rail.all()).toHaveLength(written)
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:unknown'])

  world.isMessagesBroken = false
  await talk($, world, rail, 'r3', 'third')

  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk'])
})

test('after claude --resume the rows come in chunks bottom-up — the bars stand by their turns, older decreases', async ($, on) => {
  const world = newWorld('sess-resumed', [
    human('first'),
    tool('Read', { file_path: '/w/a.txt' }),
    reply(),
    human('second'),
    reply(),
    human('third'),
    tool('Edit', { file_path: '/w/a.txt' }),
    reply(),
    human('fourth'),
    reply(),
  ])
  const rail = stage(on, world)

  // The engine draws the last row before `session.start` (E1).
  await render($, 'r4', 'fourth')
  await startSession($, rail)
  expect(brief(rail.last())).toEqual(['r4:talk'])
  expect(rail.last()?.older).toBe(3)

  // PageUp: a chunk above the viewport, then one more.
  await render($, 'r2', 'second')
  await draw($, rail, 'r3', 'third')
  expect(brief(rail.last())).toEqual(['r2:talk', 'r3:edit', 'r4:talk'])
  expect(rail.last()?.older).toBe(1)

  await draw($, rail, 'r1', 'first')
  expect(brief(rail.last())).toEqual(['r1:work', 'r2:talk', 'r3:edit', 'r4:talk'])
  expect(rail.last()?.older).toBe(0)
})

test('after claude --resume and scrolling up, a prompt submitted during a turn stands at the end of the rail', async ($, on) => {
  const numbers = [10, 11, 12, 13, 14, 15, 16, 17]
  const world = newWorld(
    'sess-r18',
    numbers.flatMap((n) => [human(`prompt ${n}`), reply()]),
  )
  const rail = stage(on, world)

  await render($, 'r17', 'prompt 17')
  await startSession($, rail)

  // Scrolling up draws the rows R16 … R10 — in this order.
  for (const n of [16, 15, 14, 13, 12, 11, 10]) {
    await draw($, rail, `r${n}`, `prompt ${n}`)
  }

  const bound = numbers.map((n) => `r${n}:talk`)
  expect(brief(rail.last())).toEqual(bound)

  // R18 is seen after R10, but it is the newest prompt: at the end of the rail during the turn too.
  await send($, world, rail, 'r18', 'prompt 18')
  expect(brief(rail.last())).toEqual([...bound, 'r18:unknown'])

  // A prompt delivered into the running turn: at the end too.
  await deliver($, rail, 'q', 'and also note this')
  expect(brief(rail.last())).toEqual([...bound, 'r18:unknown', 'q:unknown'])

  world.messages.push(human('prompt 18'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual([...bound, 'r18:talk', 'q:unknown'])
})

test('after claude --resume a prompt submitted in this process is newer than a row with the same text drawn by scrolling later', async ($, on) => {
  const world = newWorld('sess-same-scroll', [
    human('y'),
    reply(),
    human('yes'),
    tool('Edit', { file_path: '/w/a.txt' }),
    reply(),
    human('x'),
    reply(),
  ])
  const rail = stage(on, world)

  await render($, 'r3', 'x')
  await startSession($, rail)

  // The same text is submitted again; its turn is work without edits.
  await send($, world, rail, 'r4', 'yes')
  world.messages.push(human('yes'), tool('Read'), reply())
  await completeTurn($, world, rail)

  // Scrolling up drew the chunk above, with the earlier "yes" in it.
  await render($, 'r1', 'y')
  await draw($, rail, 'r2', 'yes')

  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:edit', 'r3:talk', 'r4:work'])
})

test('the error flag lands on the row of the turn\'s prompt, not on a row with the same text drawn by scrolling during the turn', async ($, on) => {
  const world = newWorld('sess-mark-scroll', [human('continue'), reply(), human('x'), reply()])
  const rail = stage(on, world)

  await render($, 'r2', 'x')
  await startSession($, rail)
  await send($, world, rail, 'r3', 'continue')

  // While the turn runs, scrolling up drew the earlier "continue".
  await draw($, rail, 'r1', 'continue')
  world.messages.push(human('continue'))
  await completeTurn($, world, rail, 'error')

  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:talk', 'r3:talk!'])
})

test('a prompt delivered into the running turn takes no turn by its text: the earlier prompt with the same text keeps its summary and place', async ($, on) => {
  const world = newWorld('sess-delivered-same')
  const rail = stage(on, world)

  await send($, world, rail, 'r0', 'yes')
  world.messages.push(human('yes'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)
  await talk($, world, rail, 'r1', 'second')

  // "yes" is delivered into the turn "third": it has no transcript record (E5).
  await send($, world, rail, 'r2', 'third')
  await deliver($, rail, 'r3', 'yes')
  world.messages.push(human('third'), reply())
  await completeTurn($, world, rail)
  await talk($, world, rail, 'r4', 'fourth')

  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:talk', 'r3:unknown', 'r4:talk'])
})

test('after claude --resume scrolling drew an earlier prompt with the text of the one delivered into the turn: the bar of the delivered one stays', async ($, on) => {
  const world = newWorld('sess-delivered-scroll', [
    human('yes'),
    tool('Edit', { file_path: '/w/a.txt' }),
    reply(),
    human('first'),
    reply(),
  ])
  const rail = stage(on, world)

  await render($, 'r1', 'first')
  await startSession($, rail)
  await submit($, 'second')
  await send($, world, rail, 'r2', 'second')
  await deliver($, rail, 'q', 'yes')
  world.messages.push(human('second'), reply())
  await completeTurn($, world, rail)

  // The key "yes" still waits: a delivered prompt cannot be told from a waiting one. A row of the same text drawn by
  // scrolling is like the row of a waiting prompt, but the next submit means the queue is empty, and the bar of the
  // delivered one is intact.
  await draw($, rail, 'r0', 'yes')
  await submit($, 'third')
  await talk($, world, rail, 'r3', 'third')

  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:talk', 'q:unknown', 'r3:talk'])
})

test('a prompt that waited for the end of the turn, with the text of an earlier one: its row comes before its turn starts and does not take the earlier summary', async ($, on) => {
  const world = newWorld('sess-waiting-same')
  const rail = stage(on, world)

  await send($, world, rail, 'r0', 'yes')
  world.messages.push(human('yes'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)

  // "yes" is typed while the model answers with text: it waits under temporary rows.
  await send($, world, rail, 'r1', 'second')
  await submit($, 'yes')
  await draw($, rail, 'tmp-1', 'yes')
  await draw($, rail, 'tmp-2', 'yes')
  world.messages.push(human('second'), reply())

  // The order from the experiment log (E5): the end of the turn, the final row, the start of the turn "yes".
  await completeTurn($, world, rail)
  await draw($, rail, 'r2', 'yes')
  await startTurn($, world, 'yes')
  await rail.clock.settle()
  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:unknown'])
  expect(rail.last()?.current).toBeNull()

  world.messages.push(human('yes'), tool('Read'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['r0:edit', 'r1:talk', 'r2:work'])
})

test('a mod reload in a long feed: the bars of the rows not redrawn stay, a redrawn row binds by its own text', async ($, on) => {
  const pasted = '\n\n<pasted_content id="225b">\npaste\n</pasted_content id="225b">\n\nhow many lines?'
  const edited = summary({ tools: 1, edits: 1 })
  seedRail(on, {
    bars: [
      { id: 'r1', text: 'edit', summary: edited },
      { id: 'r2', text: barText(pasted), summary: null },
      { id: 'r3', text: 'question', summary: null },
    ],
    older: 0,
    current: null,
  })
  const world = newWorld('sess-reload', [
    human('edit'),
    tool('Edit', { file_path: '/w/a.txt' }),
    reply(),
    human(pasted),
    reply(),
    human('question'),
    reply(),
  ])
  const rail = stage(on, world)

  // After the reload the engine redrew only the mounted row r3.
  await render($, 'r3', 'question')
  await startSession($, rail)
  // r2 is seeded with the bar text (the paste is a token): no turn is found by it, the bar keeps its own summary.
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:unknown', 'r3:talk'])

  // Scrolling redrew r2: the real text of the row binds it to its turn.
  await draw($, rail, 'r2', pasted)
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk'])
})

test('a write after a transcript read without a submitted prompt keeps current', async ($, on) => {
  // Before the mod reload: a jump to the bar r1.
  seedRail(on, {
    bars: [
      { id: 'r1', text: 'first', summary: null },
      { id: 'r2', text: 'second', summary: null },
    ],
    older: 0,
    current: 'r1',
  })
  const world = newWorld('sess-current', [human('first'), tool('Read'), reply(), human('second'), reply()])
  const rail = stage(on, world)

  await render($, 'r1', 'first')
  await render($, 'r2', 'second')
  await startSession($, rail)

  expect(brief(rail.last())).toEqual(['r1:work', 'r2:talk'])
  expect(rail.last()?.current).toBe('r1')

  // A task notification turn: there is no human row, the reading bar is the same.
  await startTurn($, world, NOTIFICATION)
  world.messages.push(human(NOTIFICATION), reply())
  await completeTurn($, world, rail)

  expect(rail.last()?.current).toBe('r1')
})

test('/clear: a row of the new session before the end of the first turn — the bar is there, the old ones are not', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'alpha')
  expect(brief(rail.last())).toEqual(['a1:talk'])

  await changeSession($, world, rail, 'clear', 'sess-b')
  expect(rail.last()).toEqual({ bars: [], older: 0, current: null })
  expect(world.calls.invalidate).toBe(1)

  // The first row of the new feed reads its transcript in the middle of the turn: the turn of this prompt is already
  // there, but it is not "above the first bar".
  world.messages.push(human('hello'))
  await send($, world, rail, 'b1', 'hello')
  expect(brief(rail.last())).toEqual(['b1:unknown'])
  expect(rail.last()?.older).toBe(0)

  world.messages.push(tool('Read'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['b1:work'])
  expect(rail.last()?.older).toBe(0)
})

test('after /clear the rail is written over the stored one: the jump and the summaries of the bars that lost their turn stay', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'alpha')
  await changeSession($, world, rail, 'clear', 'sess-b')

  await send($, world, rail, 'b1', 'fix it')
  world.messages.push(human('fix it'), tool('Edit', { file_path: '/w/b.txt' }), reply())
  await completeTurn($, world, rail)
  await talk($, world, rail, 'b2', 'question')
  expect(brief(rail.last())).toEqual(['b1:edit', 'b2:talk'])

  // `/compact` without the old turns: the bar b1 no longer has a turn.
  world.messages = [human(COMPACT_SUMMARY), human('question'), reply()]
  await talk($, world, rail, 'b3', 'more')

  expect(brief(rail.last())).toEqual(['b1:edit', 'b2:talk', 'b3:talk'])
})

test('/resume does not mix the rows of two sessions: the rows of the feed that left are not taken after session.end', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'alpha')
  await talk($, world, rail, 'a2', 'beta')

  await changeSession($, world, rail, 'resume', 'sess-b', [
    human('old question'),
    tool('Edit', { file_path: '/w/b.txt' }),
    reply(),
    human('another question'),
    reply(),
  ])

  // The engine keeps drawing the rows of the feed that left after session.end too (E7).
  await render($, 'a1', 'alpha')
  await draw($, rail, 'a2', 'beta')
  expect(brief(rail.last())).toEqual([])

  // `/resume` inside the process draws all the rows of the new feed (E1): the transcript of the new session is
  // read without waiting for a turn.
  const reads = world.calls.messages
  await render($, 'b1', 'old question')
  await draw($, rail, 'b2', 'another question')
  expect(brief(rail.last())).toEqual(['b1:edit', 'b2:talk'])
  expect(world.calls.messages).toBe(reads + 1)

  // The transcript of the new feed is read: the next rows do not ask for a read.
  await draw($, rail, 'b3', 'a question scrolled to later')
  expect(world.calls.messages).toBe(reads + 1)
})

test('/resume: a read that still sees the id of the session that left is not applied', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'question')

  await changeSession($, world, rail, 'resume', 'sess-b', [human('question'), tool('Edit', { file_path: '/w/b.txt' }), reply()])

  // The change is not over yet: the id is the previous one, and a row of the new feed is already drawn.
  world.sessionId = 'sess-a'
  await draw($, rail, 'b1', 'question')
  expect(brief(rail.last())).toEqual(['b1:unknown'])

  world.sessionId = 'sess-b'
  await draw($, rail, 'b2', 'other')
  expect(brief(rail.last())).toEqual(['b1:edit', 'b2:unknown'])
})

test('/resume: a read that still sees the id of the session that left retries by itself, without a new row', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'question')

  await changeSession($, world, rail, 'resume', 'sess-b', [human('question'), tool('Edit', { file_path: '/w/b.txt' }), reply()])
  world.sessionId = 'sess-a'
  await draw($, rail, 'b1', 'question')
  expect(brief(rail.last())).toEqual(['b1:unknown'])

  // The change is over; there are no new rows, `/resume` drew them all at once.
  world.sessionId = 'sess-b'
  await rail.clock.advance(50)

  expect(brief(rail.last())).toEqual(['b1:edit'])
})

test('/resume of the same session: a read with its id is applied once a turn has started in it', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'question')

  await changeSession($, world, rail, 'resume', 'sess-a', [human('question'), reply()])

  // The id is the same as that of the feed that left: only the start of a turn says the change is over.
  await send($, world, rail, 'a2', 'more')
  expect(brief(rail.last())).toEqual(['a2:unknown'])

  world.messages.push(human('more'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['a2:talk'])
})

test('the feed changes while a prompt waits in the queue: the queue and the turn of the previous feed do not touch the new one', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await send($, world, rail, 'a1', 'alpha')
  await submit($, 'yes')
  await draw($, rail, 'a-tmp-1', 'yes')
  await draw($, rail, 'a-tmp-2', 'yes')

  await changeSession($, world, rail, 'clear', 'sess-b')

  // The rows of the feed that left, drawn after the change, — and the one its cache dropped itself (a-tmp-1
  // is replaced by a-tmp-2), — do not go into the new one.
  await draw($, rail, 'a-tmp-1', 'yes')
  await draw($, rail, 'a-tmp-2', 'yes')

  // The new feed: a row "yes" seen without a turn is neither a temporary one nor the turn's prompt.
  await draw($, rail, 'b1', 'yes')
  await talk($, world, rail, 'b2', 'yes')

  expect(brief(rail.last())).toEqual(['b1:unknown', 'b2:talk'])
})

test('/resume back into the previous session: its rows go into the cache again', async ($, on) => {
  const world = newWorld('sess-a', [human('alpha'), reply()])
  const rail = stage(on, world)

  await render($, 'a1', 'alpha')
  await startSession($, rail)
  await changeSession($, world, rail, 'resume', 'sess-b', [human('beta'), reply()])
  await draw($, rail, 'b1', 'beta')
  expect(brief(rail.last())).toEqual(['b1:talk'])

  await changeSession($, world, rail, 'resume', 'sess-a', [human('alpha'), reply()])
  await draw($, rail, 'a1', 'alpha')

  expect(brief(rail.last())).toEqual(['a1:talk'])
})

test('a session.id failure keeps the previous rail', async ($, on) => {
  const world = newWorld('sess-id')
  const rail = stage(on, world)

  await talk($, world, rail, 'r1', 'first')
  const written = rail.all().length

  world.isIdBroken = true
  await send($, world, rail, 'r2', 'second')
  world.messages.push(human('second'), tool('Read'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:unknown'])
  expect(rail.all()).toHaveLength(written + 1)
  expect(world.calls.invalidate).toBe(0)

  world.isIdBroken = false
  await talk($, world, rail, 'r3', 'third')
  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:work', 'r3:talk'])
})

test('a session.end not from /clear or /resume does not change the feed', async ($, on) => {
  const world = newWorld('sess-end')
  const rail = stage(on, world)

  await talk($, world, rail, 'r1', 'first')

  for (const reason of ['logout', 'prompt_input_exit', 'other'] as const) {
    await $.session.end({ reason, sessionId: world.sessionId, resume: { id: world.sessionId } })
    await rail.clock.settle()
  }

  expect(world.calls.invalidate).toBe(0)
  expect(brief(rail.last())).toEqual(['r1:talk'])
  await talk($, world, rail, 'r2', 'second')
  expect(brief(rail.last())).toEqual(['r1:talk', 'r2:talk'])
})

test('the transcript is capped: the rows older than it, drawn by scrolling up, are at the start of the rail', async ($, on) => {
  // The newest MESSAGES_MAX records: the turns 14–17 and the tail of an older turn.
  const kept = [14, 15, 16, 17].flatMap((n) => [human(`prompt ${n}`), reply()])
  const world = newWorld('sess-capped', [...Array.from({ length: MESSAGES_MAX - kept.length }, () => reply()), ...kept])
  const rail = stage(on, world)

  await render($, 'r17', 'prompt 17')
  await startSession($, rail)

  for (const n of [14, 15, 16, 12, 13]) {
    await draw($, rail, `r${n}`, `prompt ${n}`)
  }

  expect(brief(rail.last())).toEqual(['r12:unknown', 'r13:unknown', 'r14:talk', 'r15:talk', 'r16:talk', 'r17:talk'])
})

test('race: /resume between the transcript read and the write — the turns of the session that left are not written', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)
  const gate = gateMessages(world)

  await startSession($, rail)
  await send($, world, rail, 'a1', 'question')
  world.messages.push(human('question'), tool('Edit', { file_path: '/w/a.txt' }), reply())

  // The end of the turn reads the transcript of A, and the read is held.
  gate.arm()
  const completed = completeTurn($, world, rail)
  await gate.reached

  await changeSession($, world, rail, 'resume', 'sess-b', [human('question'), reply()])
  expect(rail.last()).toEqual({ bars: [], older: 0, current: null })

  // A turn with the same text started in the new feed, and then the held read of A returned.
  await send($, world, rail, 'b1', 'question')
  gate.release()
  await completed

  // The turn of A did not land on the row of B.
  expect(brief(rail.last())).toEqual(['b1:unknown'])

  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['b1:talk'])
})

test('race: an early transcript read that returned after a later one is not applied', async ($, on) => {
  const world = newWorld('sess-order')
  const rail = stage(on, world)
  const gate = gateMessages(world)

  await startSession($, rail)
  await send($, world, rail, 'r1', 'fix it')
  world.messages.push(human('fix it'), tool('Edit', { file_path: '/w/a.txt' }), reply())

  // The read after the turn r1 is held; meanwhile the turn r2 and its read went through.
  gate.arm()
  const first = completeTurn($, world, rail)
  await gate.reached
  await talk($, world, rail, 'r2', 'question')
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk'])

  // The early read (without the turn r2) does not wipe the turns and does not pass for a rewind.
  gate.release()
  await first
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk'])

  await talk($, world, rail, 'r3', 'more')
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk'])
})

test('the session id changed without session.end — the same reset, a redraw brings back the rows of the new feed', async ($, on) => {
  const world = newWorld('sess-a')
  const rail = stage(on, world)

  await startSession($, rail)
  await talk($, world, rail, 'a1', 'alpha')

  // A `/clear` whose session.end the mod did not hear.
  world.sessionId = 'sess-b'
  world.messages = []
  await talk($, world, rail, 'b1', 'hello')
  expect(world.calls.invalidate).toBe(1)
  expect(brief(rail.last())).toEqual([])

  // The engine redrew the mounted rows of the new feed.
  await draw($, rail, 'b1', 'hello')
  expect(brief(rail.last())).toEqual(['b1:talk'])
})

test('/compact: the summaries of the old bars are intact — both when the transcript keeps the old turns and when it does not', async ($, on) => {
  const world = newWorld('sess-compact')
  const rail = stage(on, world)

  await send($, world, rail, 'r1', 'fix it')
  world.messages.push(human('fix it'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)
  await talk($, world, rail, 'r2', 'question')

  // `/compact` is a local command without a turn: the command records and the summary (E7).
  world.messages.push(human(COMPACT_COMMAND), human(COMPACT_STDOUT), human(COMPACT_SUMMARY))
  await talk($, world, rail, 'r3', 'after compaction')
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk'])

  // The transcript without the old turns: the bars keep the written summaries.
  world.messages = [human(COMPACT_SUMMARY), human('after compaction'), reply()]
  await talk($, world, rail, 'r4', 'more')

  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk', 'r4:talk'])
  expect(rail.last()?.older).toBe(0)
})

test('/rewind: the bars past the rewind point disappear, the bars of the old history stay', async ($, on) => {
  const world = newWorld('sess-rewind')
  const rail = stage(on, world)

  await startSession($, rail)
  await send($, world, rail, 'r1', 'first')
  world.messages.push(human('first'), tool('Edit', { file_path: '/w/a.txt' }), reply())
  await completeTurn($, world, rail)
  await talk($, world, rail, 'r2', 'second')
  const kept = [...world.messages]
  await talk($, world, rail, 'r3', 'third')

  // A prompt delivered into the turn "fourth".
  await send($, world, rail, 'r4', 'fourth')
  await deliver($, rail, 'q4', 'and also note this')
  world.messages.push(human('fourth'), reply())
  await completeTurn($, world, rail)
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r3:talk', 'r4:talk', 'q4:unknown'])

  // `/rewind` by two turns: the rows r3, r4 and q4 left the feed without an event, the transcript lost their
  // turns. Then a new prompt.
  world.messages = kept
  await talk($, world, rail, 'r5', 'fifth')

  // The engine did not redraw the rows r1 and r2 — their bars are in place.
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r5:talk'])
  expect(world.calls.invalidate).toBe(0)

  // The cache dropped the rewound rows itself: redrawing them brings no bars back and schedules no write.
  const sets = world.calls.set
  await draw($, rail, 'r4', 'fourth')
  await draw($, rail, 'q4', 'and also note this')
  expect(world.calls.set).toBe(sets)
  expect(brief(rail.last())).toEqual(['r1:edit', 'r2:talk', 'r5:talk'])
})
