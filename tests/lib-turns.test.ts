import type { SessionMessage, TurnCompleteReason } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import {
  bindTurns,
  commandKey,
  isHumanOrigin,
  isHumanRow,
  kindOf,
  markBars,
  markSummary,
  rewound,
  splitTurns,
  startedKeys,
  summarize,
  textKey,
  withoutRunning,
} from '../hooks/lib'
import type { Row, Turn } from '../hooks/lib'
import type { Bar, TurnSummary } from '../types'
import {
  COMPACT_COMMAND,
  COMPACT_STDOUT,
  COMPACT_SUMMARY,
  human,
  IMAGE,
  NOTIFICATION,
  PASTED,
  reply,
  results,
  summary,
  tool,
  tools,
} from './world'

// Transcript entries, in the shape `$.session.messages()` returned them in the
// experiment of task 2 (logs `sr-spike.part1.log`, `sr-spike.part2.log`); the ones
// shared with the hook tests are in `world.tsx`.

const NOTE = '/Users/me/work/sr-note.txt'
const GAMMA = '/Users/me/work/sr-gamma.txt'

const SKILL_COMMAND = '<command-message>workflow:clarify</command-message>\n<command-name>/workflow:clarify</command-name>'
const SKILL_COMMAND_ARGS =
  '<command-message>session-journal</command-message>\n<command-name>/session-journal</command-name>\n<command-args>summary</command-args>'
const CLEAR_COMMAND =
  '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>'

/** A turn with a text and a summary. */
function turn(text: string, fields: Partial<TurnSummary> = {}): Turn {
  return { text, summary: summary(fields) }
}

/** A feed row with an id, a text and the number of its first appearance. */
function row(id: string, text: string, order: number): Row {
  return { id, key: textKey(text), text, order }
}

/** The row of a prompt the mod saw submitted during a turn (`isLive`). */
function sent(id: string, text: string, order: number): Row {
  return { ...row(id, text, order), isLive: true }
}

/** The row of a prompt whose turn has not ended yet (`isHeld`). */
function held(id: string, text: string, order: number): Row {
  return { ...sent(id, text, order), isHeld: true }
}

/** Bars as pairs "id: tool calls of the summary", `?` — no summary: shorter to compare order and binding. */
function brief(bars: readonly Bar[]): string[] {
  return bars.map((bar) => `${bar.id}:${bar.summary === null ? '?' : bar.summary.tools}`)
}

describe('isHumanOrigin', () => {
  test('the prompt input and Remote Control are a human', () => {
    expect(isHumanOrigin({ kind: 'composer' })).toBe(true)
    expect(isHumanOrigin({ kind: 'bridge' })).toBe(true)
  })

  test('a task notification, the SDK, a plugin, another session are not a human', () => {
    expect(isHumanOrigin({ kind: 'task-notification' })).toBe(false)
    expect(isHumanOrigin({ kind: 'sdk' })).toBe(false)
    expect(isHumanOrigin({ kind: 'plugin', name: 'other' })).toBe(false)
    expect(isHumanOrigin({ kind: 'peer-send-message' })).toBe(false)
  })
})

describe('isHumanRow', () => {
  test('a prompt from the prompt input and through Remote Control is a bar', () => {
    expect(isHumanRow('3e2fdad0', { kind: 'composer' }, 'answer in one word: ok')).toBe(true)
    expect(isHumanRow('3e2fdad0', { kind: 'bridge' }, 'ok')).toBe(true)
  })

  test('the placeholder row of a just submitted prompt is not a bar', () => {
    expect(isHumanRow('placeholder', { kind: 'composer' }, 'answer in one word: ok')).toBe(false)
  })

  test('a task notification, the SDK, other origins are not a bar', () => {
    expect(isHumanRow('a1', { kind: 'task-notification' }, 'Agent "md files" finished')).toBe(false)
    expect(isHumanRow('a1', { kind: 'sdk' }, 'ok')).toBe(false)
  })

  test('an empty and a whitespace-only text is not a bar', () => {
    expect(isHumanRow('a1', { kind: 'composer' }, '')).toBe(false)
    expect(isHumanRow('a1', { kind: 'composer' }, ' \n\t ')).toBe(false)
  })
})

describe('textKey', () => {
  test('trims the edges and collapses whitespace runs', () => {
    expect(textKey('  yes,\n\n  go   on\t')).toBe('yes, go on')
  })

  test('a paste and an image tag stay in the key', () => {
    expect(textKey(PASTED)).toContain('<pasted_content id="225b">')
    expect(textKey(PASTED)).not.toBe(textKey('how many lines are in the paste? answer with a number'))
    expect(textKey(IMAGE)).toBe(IMAGE)
  })
})

describe('summarize', () => {
  test('talk: no tool calls', () => {
    expect(summarize([human('answer in one word: ok'), reply(''), reply('ok')])).toEqual(summary())
  })

  test('work: tool calls without edits, subagents and skills', () => {
    const got = summarize([human('find'), tool('Grep', { pattern: 'x' }), results(), tools({ tool: 'Bash' }, { tool: 'Read' })])

    expect(got).toEqual(summary({ tools: 3 }))
  })

  test('edits: one file twice is one file; NotebookEdit by notebook_path; a call without a path is a separate file', () => {
    const got = summarize([
      tool('Write', { file_path: NOTE, content: 'hello' }),
      results(),
      tool('Edit', { file_path: NOTE, old_string: 'hello', new_string: 'hello\nworld' }),
      results(),
      tool('NotebookEdit', { notebook_path: '/Users/me/work/a.ipynb' }),
      tool('Edit', {}),
      tool('Write', { file_path: GAMMA }),
    ])

    expect(got).toEqual(summary({ tools: 5, edits: 4 }))
  })

  test('subagents: Agent and Workflow', () => {
    const got = summarize([tools({ tool: 'Agent', agentId: 'abd93b84f7166c728' }), results(), tool('Workflow')])

    expect(got).toEqual(summary({ tools: 2, agents: 2 }))
  })

  test('a skill from a Skill call: the name from input.skill, no repeats', () => {
    const got = summarize([
      tool('Skill', { skill: 'workflow:clarify', args: 'check' }),
      tool('Skill', { skill: 'review:pr' }),
      tool('Skill', { skill: 'workflow:clarify' }),
      tool('Skill', {}),
    ])

    expect(got).toEqual(summary({ tools: 4, skills: ['workflow:clarify', 'review:pr'] }))
  })

  test('error: a call with isError counts as an error, while an edit, a subagent and a skill with an error do not count', () => {
    const got = summarize([
      tool('Read', { file_path: '/nope-404.txt' }, true),
      results(true),
      tool('Edit', { file_path: NOTE }, true),
      tool('Agent', {}, true),
      tool('Skill', { skill: 'workflow:clarify' }, true),
    ])

    expect(got).toEqual(summary({ tools: 4, errors: 4 }))
  })

  test('the interrupted flag is passed as is', () => {
    expect(summarize([reply('# Terminals')], true)).toEqual(summary({ interrupted: true }))
  })
})

describe('kindOf', () => {
  test('by the first matching rule', () => {
    expect(kindOf(summary({ tools: 3, edits: 1, agents: 1, skills: ['x'] }))).toBe('edit')
    expect(kindOf(summary({ tools: 2, agents: 1, skills: ['x'] }))).toBe('agent')
    expect(kindOf(summary({ tools: 1, skills: ['x'] }))).toBe('skill')
    expect(kindOf(summary({ tools: 1 }))).toBe('work')
    expect(kindOf(summary())).toBe('talk')
    expect(kindOf(null)).toBe('unknown')
  })

  test('an error and an interruption do not change the kind', () => {
    expect(kindOf(summary({ tools: 1, errors: 1, interrupted: true }))).toBe('work')
    expect(kindOf(summary({ interrupted: true }))).toBe('talk')
  })
})

describe('splitTurns', () => {
  test('an empty transcript: no turns', () => {
    expect(splitTurns([])).toEqual([])
  })

  test('talk, edits, a subagent, an error: a turn per prompt, tool calls go to their own turn', () => {
    const turns = splitTurns([
      human('answer in one word: ok'),
      reply(''),
      reply('ok'),
      human('create the file sr-note.txt'),
      tool('Write', { file_path: NOTE }),
      results(),
      tool('Edit', { file_path: NOTE }),
      results(),
      reply('Done.'),
      human('start a subagent'),
      tools({ tool: 'Agent', agentId: 'abd93b84f7166c728' }),
      results(),
      reply('The subagent is running in the background'),
      human('read nope-404.txt'),
      tool('Read', { file_path: '/nope-404.txt' }, true),
      results(true),
      reply('No'),
    ])

    expect(turns).toEqual([
      turn('answer in one word: ok'),
      turn('create the file sr-note.txt', { tools: 2, edits: 1 }),
      turn('start a subagent', { tools: 1, agents: 1 }),
      turn('read nope-404.txt', { tools: 1, errors: 1 }),
    ])
  })

  test('a skill from a Skill call', () => {
    const turns = splitTurns([
      human('call the Skill tool'),
      tool('Skill', { skill: 'workflow:clarify', args: 'check' }),
      results(),
      reply(''),
      reply('ok'),
    ])

    expect(turns).toEqual([turn('call the Skill tool', { tools: 1, skills: ['workflow:clarify'] })])
  })

  test('an Esc interruption sets interrupted on the turn it follows and does not start a turn', () => {
    const turns = splitTurns([
      human('write an essay'),
      reply(''),
      reply('# Terminals'),
      human('[Request interrupted by user]'),
      human('next'),
      reply('ok'),
    ])

    expect(turns).toEqual([turn('write an essay', { interrupted: true }), turn('next')])
  })

  test('a permission denial: a call error and an interruption', () => {
    const turns = splitTurns([
      human('call Skill'),
      tools({ tool: 'Skill', input: { skill: 'workflow:clarify' }, isError: true, text: "The user doesn't want to proceed with this tool use." }),
      results(true),
      human('[Request interrupted by user for tool use]'),
    ])

    expect(turns).toEqual([turn('call Skill', { tools: 1, errors: 1, interrupted: true })])
  })

  test('a task notification closes the turn: its tool calls go to no bar', () => {
    const turns = splitTurns([
      human('start a subagent'),
      tools({ tool: 'Agent', agentId: 'abd93b84f7166c728' }),
      results(),
      reply('started'),
      human(NOTIFICATION),
      tool('Bash'),
      results(),
      reply('a.md, b.md'),
      human('go on'),
    ])

    expect(turns).toEqual([turn('start a subagent', { tools: 1, agents: 1 }), turn('go on')])
  })

  test('a skill slash command, with and without arguments, gives no turn with a bar and closes the current one', () => {
    const turns = splitTurns([
      human('first'),
      reply('ok'),
      human(SKILL_COMMAND),
      reply(''),
      tool('Read'),
      reply('The command is running'),
      human(SKILL_COMMAND_ARGS),
      tool('Write', { file_path: NOTE }),
      results(),
      human('second'),
    ])

    expect(turns).toEqual([turn('first'), turn('second')])
  })

  test('a local command and its output are skipped; an interruption after a command flags no one', () => {
    const turns = splitTurns([
      human(CLEAR_COMMAND),
      human('[Request interrupted by user]'),
      human('answer in one word: alpha'),
      reply('alpha'),
      human(COMPACT_COMMAND),
      human(COMPACT_STDOUT),
    ])

    expect(turns).toEqual([turn('answer in one word: alpha')])
  })

  test('local command output alone does not close the turn', () => {
    const turns = splitTurns([human('first'), tool('Bash'), human(COMPACT_STDOUT), tool('Read')])

    expect(turns).toEqual([turn('first', { tools: 2 })])
  })

  test('the /compact summary gives no turn: the repeated reply after it does not go to the previous turn', () => {
    const turns = splitTurns([
      human(CLEAR_COMMAND),
      human('answer in one word: alpha'),
      reply(''),
      reply('alpha'),
      human('create the file sr-gamma.txt with the line gamma'),
      reply(''),
      tool('Write', { file_path: GAMMA }),
      results(),
      human(COMPACT_SUMMARY),
      tool('Write', { file_path: GAMMA }),
      reply('Created the file'),
      human(COMPACT_COMMAND),
      human(COMPACT_STDOUT),
    ])

    expect(turns).toEqual([turn('answer in one word: alpha'), turn('create the file sr-gamma.txt with the line gamma', { tools: 1, edits: 1 })])
  })

  test('the transcript starts in the middle of a turn (the cap at 4096 entries): the beginning goes to no turn', () => {
    const turns = splitTurns([
      tool('Write', { file_path: NOTE }),
      results(),
      reply('Done.'),
      human('[Request interrupted by user]'),
      human('next'),
      reply('ok'),
    ])

    expect(turns).toEqual([turn('next')])
  })

  test('user entries with tool results and empty entries do not start a turn', () => {
    const turns = splitTurns([human('first'), tool('Bash'), results(), human(''), reply('ok')])

    expect(turns).toEqual([turn('first', { tools: 1 })])
  })

  test('a user entry with tool results and with a text does not start a turn', () => {
    const answered: SessionMessage = { ...results(), text: 'command output' }
    const turns = splitTurns([human('first'), tool('Bash'), answered, reply('ok')])

    expect(turns).toEqual([turn('first', { tools: 1 })])
  })

  test('a prompt that quotes the interruption entry is an ordinary prompt', () => {
    const quoting = 'why does the log say [Request interrupted by user]?'
    const turns = splitTurns([human('first'), reply('ok'), human(quoting), reply('because')])

    expect(turns).toEqual([turn('first'), turn(quoting)])
  })

  test('local command output on stderr is skipped and does not close the turn', () => {
    const stderr = '<local-command-stderr>Error: no such command</local-command-stderr>'
    const turns = splitTurns([human('first'), tool('Bash'), human(stderr), tool('Read')])

    expect(turns).toEqual([turn('first', { tools: 2 })])
  })

  test('a prompt with a paste and with an image tag is a turn with the text as is', () => {
    const turns = splitTurns([human(PASTED), reply('2'), human(IMAGE), reply('cat')])

    expect(turns.map((t) => t.text)).toEqual([PASTED, IMAGE])
  })
})

describe('withoutRunning', () => {
  test('the last turn with the text of the running turn is dropped: the transcript was read mid-turn', () => {
    const turns = [turn('first', { tools: 1 }), turn('  second\n')]

    expect(withoutRunning(turns, 'second')).toEqual([turn('first', { tools: 1 })])
  })

  test('only the last turn is dropped when the text repeats', () => {
    const turns = [turn('yes', { tools: 1 }), turn('no'), turn('yes')]

    expect(withoutRunning(turns, 'yes')).toEqual([turn('yes', { tools: 1 }), turn('no')])
  })

  test('a last turn with another text, no running turn, an empty transcript: the turns as they are', () => {
    const turns = [turn('first'), turn('second')]

    expect(withoutRunning(turns, 'first')).toBe(turns)
    expect(withoutRunning(turns, null)).toBe(turns)
    expect(withoutRunning([], 'first')).toEqual([])
  })
})

describe('commandKey', () => {
  test('a slash command as the human typed it: the name and the arguments', () => {
    expect(commandKey(SKILL_COMMAND_ARGS)).toBe('/session-journal summary')
    expect(commandKey(SKILL_COMMAND)).toBe('/workflow:clarify')
    expect(commandKey(CLEAR_COMMAND)).toBe('/clear')
  })

  test('multi-line arguments collapse like the text of a row', () => {
    const text =
      '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>file\n  README.md</command-args>'

    expect(commandKey(text)).toBe('/review file README.md')
  })

  test('a prompt without command tags and a task notification are not a command', () => {
    expect(commandKey('fix README')).toBeNull()
    expect(commandKey(NOTIFICATION)).toBeNull()
    expect(commandKey('<command-name></command-name>')).toBeNull()
  })
})

describe('startedKeys', () => {
  test('a turn with the text of a waiting prompt starts it', () => {
    expect(startedKeys('  second\n', ['first', 'second'])).toEqual(['second'])
  })

  test('a slash command turn starts the command typed into the queue', () => {
    expect(startedKeys(SKILL_COMMAND_ARGS, ['/session-journal summary'])).toEqual(['/session-journal summary'])
  })

  test('prompts merged into one: keys in queue order, a key that has waited longer is skipped', () => {
    const waiting = ['yes', 'fix README', 'and run the tests']

    expect(startedKeys('fix README\nand run the tests', waiting)).toEqual(['fix README', 'and run the tests'])
    expect(startedKeys('yes\n\nfix README', waiting)).toEqual(['yes', 'fix README'])
  })

  test('a join out of queue order, off a word boundary or with extra text is not merged prompts', () => {
    const waiting = ['fix README', 'and run the tests']

    expect(startedKeys('and run the tests\nfix README', waiting)).toEqual([])
    expect(startedKeys('fix READMEand run the tests', waiting)).toEqual([])
    expect(startedKeys('fix README\nand run the tests\nand more', waiting)).toEqual([])
  })

  test('a turn that started no waiting prompt: empty', () => {
    expect(startedKeys(NOTIFICATION, ['yes'])).toEqual([])
    expect(startedKeys('yes', [])).toEqual([])
  })
})

describe('bindTurns', () => {
  test('as many rows as turns: every bar has the summary of its own turn', () => {
    const rows = [row('a', 'first', 0), row('b', 'second', 1), row('c', 'third', 2)]
    const turns = [turn('first'), turn('second', { tools: 2 }), turn('third', { tools: 1, edits: 1 })]
    const got = bindTurns(rows, turns)

    expect(got.older).toBe(0)
    expect(got.bars).toEqual([
      { id: 'a', text: 'first', summary: summary() },
      { id: 'b', text: 'second', summary: summary({ tools: 2 }) },
      { id: 'c', text: 'third', summary: summary({ tools: 1, edits: 1 }) },
    ])
  })

  test('no rows and no turns: empty', () => {
    expect(bindTurns([], [])).toEqual({ bars: [], older: 0 })
  })

  test('fewer rows than turns: after claude --resume the last row is drawn, older counts the turns older than it', () => {
    const turns = [turn('first'), turn('second'), turn('third', { tools: 4 })]
    const got = bindTurns([row('c', 'third', 0)], turns)

    expect(brief(got.bars)).toEqual(['c:4'])
    expect(got.older).toBe(2)
  })

  test('fewer rows than turns: rows arrive in chunks bottom-up, older decreases', () => {
    const turns = [turn('t0'), turn('t1', { tools: 1 }), turn('t2', { tools: 2 }), turn('t3', { tools: 3 })]
    const got = bindTurns([row('r3', 't3', 0), row('r1', 't1', 1), row('r2', 't2', 2)], turns)

    expect(brief(got.bars)).toEqual(['r1:1', 'r2:2', 'r3:3'])
    expect(got.older).toBe(1)
  })

  test('fewer turns than rows: a turn is running, the newest row has no summary and stands at the end', () => {
    const got = bindTurns([row('a', 'first', 0), held('b', 'second', 1)], [turn('first', { tools: 1 })])

    expect(brief(got.bars)).toEqual(['a:1', 'b:?'])
    expect(got.older).toBe(0)
  })

  test('no row is bound: older counts all turns', () => {
    const got = bindTurns([row('x', 'rewritten prompt', 0)], [turn('first'), turn('second')])

    expect(brief(got.bars)).toEqual(['x:?'])
    expect(got.older).toBe(2)
  })

  test('the prompt of the running turn takes no turn even when a turn with its text exists: a mid-turn read drops it', () => {
    const got = bindTurns([held('b1', 'hello', 0)], [turn('old'), turn('hello', { tools: 1 })])

    expect(brief(got.bars)).toEqual(['b1:?'])
    expect(got.older).toBe(2)
  })

  test('rows without a turn of their own (temporary, delivered into a turn) take no turn by text', () => {
    const rows = [row('d1', 'yes', 0), { ...sent('q', 'yes', 1), isTurnless: true }]

    expect(brief(bindTurns(rows, [turn('yes', { tools: 3 })]).bars)).toEqual(['d1:3', 'q:?'])
  })

  test('equal texts: the newest turns take the rows seen last', () => {
    const rows = [row('d1', 'yes', 0), row('n', 'no', 1), row('d2', 'yes', 2)]
    const turns = [turn('yes', { tools: 1 }), turn('no'), turn('yes', { tools: 2 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['d1:1', 'n:0', 'd2:2'])
  })

  test('equal texts in bottom-up chunks: turns go by the neighbours of the rows, not by order of appearance', () => {
    // Turns: yes, m1, m2, yes, x. The lower chunk (yes, x) is drawn first, then the upper one (yes, m1, m2).
    const rows = [row('d4', 'yes', 0), row('x', 'x', 1), row('d1', 'yes', 2), row('m1', 'm1', 3), row('m2', 'm2', 4)]
    const turns = [turn('yes', { tools: 1 }), turn('m1'), turn('m2'), turn('yes', { tools: 4 }), turn('x')]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['d1:1', 'm1:0', 'm2:0', 'd4:4', 'x:0'])

    // Two equal ones in a row in the upper chunk: a, yes, yes, b, yes, c; the lower chunk is yes, c.
    const pair = [row('e4', 'yes', 0), row('c', 'c', 1), row('a', 'a', 2), row('e1', 'yes', 3), row('e2', 'yes', 4), row('b', 'b', 5)]
    const texts = [turn('a'), turn('yes', { tools: 1 }), turn('yes', { tools: 2 }), turn('b'), turn('yes', { tools: 4 }), turn('c')]

    expect(brief(bindTurns(pair, texts).bars)).toEqual(['a:0', 'e1:1', 'e2:2', 'b:0', 'e4:4', 'c:0'])
  })

  test('equal texts: a prompt submitted in this process is newer than a row drawn by scrolling later', () => {
    // After claude --resume row x is visible, "yes" (d2) is submitted, then scrolling drew the earlier "yes" (d1).
    const rows = [row('x', 'x', 0), sent('d2', 'yes', 1), row('y', 'y', 2), row('d1', 'yes', 3)]
    const turns = [turn('y'), turn('yes', { tools: 1 }), turn('x'), turn('yes', { tools: 2 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['y:0', 'd1:1', 'x:0', 'd2:2'])
  })

  test('equal texts: the group has fewer rows than turns, the row takes the newest turn', () => {
    const turns = [turn('yes', { tools: 1 }), turn('no'), turn('yes', { tools: 2 })]
    const got = bindTurns([row('d2', 'yes', 0)], turns)

    expect(brief(got.bars)).toEqual(['d2:2'])
    expect(got.older).toBe(2)
  })

  test('"yes, yes, a turn is running": the newest row does not take the summary of the previous "yes" turn', () => {
    const rows = [row('d1', 'yes', 0), held('d2', 'yes', 1)]
    const turns = [turn('yes', { tools: 5 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['d1:5', 'd2:?'])
  })

  test('a turn is running: only the submitted prompt is held, rows drawn by scrolling are bound', () => {
    const rows = [row('b', 'second', 0), held('c', 'third', 1), row('a', 'first', 2)]
    const turns = [turn('first', { tools: 1 }), turn('second', { tools: 2 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['a:1', 'b:2', 'c:?'])
    // The turn ended: the row is no longer held, and it has no turn in the transcript.
    expect(brief(bindTurns(rows.map((item) => ({ ...item, isHeld: false })), turns).bars)).toEqual(['a:1', 'b:2', 'c:?'])
  })

  test('after claude --resume rows drawn by scrolling during a turn are placed by turns, not after the submitted prompt', () => {
    // R17 … R10 are bound, R18 is submitted, during its turn scrolling draws R9 and R8.
    const rows = [17, 16, 15, 14, 13, 12, 11, 10].map((n, i) => row(`r${n}`, `t${n}`, i))
    const turns = Array.from({ length: 18 }, (_, n) => turn(`t${n}`, { tools: n }))
    const scrolled = [row('r9', 't9', 9), row('r8', 't8', 10)]
    const got = bindTurns([...rows, held('r18', 't18', 8), ...scrolled], turns)

    expect(brief(got.bars)).toEqual([...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((n) => `r${n}:${n}`), 'r18:?'])
    expect(got.older).toBe(8)
  })

  test('a mismatched text in the middle: a bar without a summary in the place of the row, the neighbours are bound', () => {
    const rows = [row('a', 'first', 0), row('x', 'second, rewritten by a plugin', 1), row('c', 'third', 2)]
    const turns = [turn('first', { tools: 1 }), turn('second', { tools: 2 }), turn('third', { tools: 3 })]
    const got = bindTurns(rows, turns)

    expect(brief(got.bars)).toEqual(['a:1', 'x:?', 'c:3'])
    expect(got.older).toBe(0)
  })

  test('rows arrived out of feed order: bars by turn index', () => {
    const rows = [row('r4', 't4', 0), row('r3', 't3', 1), row('r1', 't1', 2), row('r2', 't2', 3), row('r0', 't0', 4)]
    const turns = [0, 1, 2, 3, 4].map((n) => turn(`t${n}`, { tools: n }))

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['r0:0', 'r1:1', 'r2:2', 'r3:3', 'r4:4'])
  })

  test('a prompt delivered into the running turn: the row without a turn stands between bound ones, after the one seen before it', () => {
    const rows = [row('a', 'first', 0), row('q', 'and also consider this', 1), row('b', 'second', 2)]
    const turns = [turn('first', { tools: 3 }), turn('second', { tools: 1 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['a:3', 'q:?', 'b:1'])
  })

  test('an unbound row in a bottom-up chunk stands after the row seen before it', () => {
    // The window is at the end: t2 and t3 are visible; scrolling up draws t0, a row without a turn and t1.
    const rows = [row('r2', 't2', 0), row('r3', 't3', 1), row('r0', 't0', 2), row('q', 'delivered into a turn', 3), row('r1', 't1', 4)]
    const turns = [0, 1, 2, 3].map((n) => turn(`t${n}`, { tools: n }))

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['r0:0', 'q:?', 'r1:1', 'r2:2', 'r3:3'])
  })

  test('after claude --resume and scrolling up a prompt submitted during a turn stands at the end', () => {
    // R17 … R10 are seen bottom-up, R18 is the newest prompt, its turn is running.
    const rows = [17, 16, 15, 14, 13, 12, 11, 10].map((n, i) => row(`r${n}`, `t${n}`, i))
    const turns = Array.from({ length: 18 }, (_, n) => turn(`t${n}`, { tools: n }))
    const bound = [10, 11, 12, 13, 14, 15, 16, 17].map((n) => `r${n}:${n}`)

    expect(brief(bindTurns([...rows, held('r18', 't18', 8)], turns).bars)).toEqual([...bound, 'r18:?'])
  })

  test('after claude --resume and scrolling up a prompt delivered into a notification turn stands at the end after the turn', () => {
    const rows = [17, 16, 15].map((n, i) => row(`r${n}`, `t${n}`, i))
    const turns = Array.from({ length: 18 }, (_, n) => turn(`t${n}`, { tools: n }))
    const delivered: Row = { ...row('q', 'and this too', 3), isLive: true, isTurnless: true }

    expect(brief(bindTurns([...rows, delivered], turns).bars)).toEqual(['r15:15', 'r16:16', 'r17:17', 'q:?'])
  })

  test('rows of prompts still waiting in the queue (isQueued) are at the very end of the rail, after the prompt of the running turn', () => {
    // "third" and "fourth" are typed during the "first" turn; so is "second", its turn is running.
    const queued = (id: string, text: string, order: number): Row => ({
      ...sent(id, text, order),
      isTurnless: true,
      isQueued: true,
    })
    const rows = [row('a', 'first', 0), queued('c', 'third', 1), queued('d', 'fourth', 2), held('b', 'second', 3)]

    expect(brief(bindTurns(rows, [turn('first', { tools: 1 })]).bars)).toEqual(['a:1', 'b:?', 'c:?', 'd:?'])
    // Without the flag a row without a turn stands after the row of the turn it was delivered into.
    const delivered = rows.map((item) => ({ ...item, isQueued: false }))
    expect(brief(bindTurns(delivered, [turn('first', { tools: 1 })]).bars)).toEqual(['a:1', 'c:?', 'd:?', 'b:?'])
  })

  test('a row without a turn seen during a turn but older than a bound one stands after the row seen before it', () => {
    // q is delivered into the "first" turn; then the "second" turn came.
    const rows = [row('a', 'first', 0), { ...row('q', 'and more', 1), isLive: true }, row('b', 'second', 2)]
    const turns = [turn('first', { tools: 1 }), turn('second', { tools: 2 })]

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['a:1', 'q:?', 'b:2'])
  })

  test('the first seen row without a turn stands at the start', () => {
    const rows = [row('q', 'no turn', 0), row('q2', 'also no turn', 1), row('a', 'first', 2)]

    expect(brief(bindTurns(rows, [turn('first', { tools: 1 })]).bars)).toEqual(['q:?', 'q2:?', 'a:1'])
  })

  test('a row without a turn that begins a bottom-up chunk stands before it, not at the end of the rail', () => {
    // The window is at the end: Q4 and Q5 are visible; scrolling up draws D (delivered into turn Q1), Q2 and Q3.
    const rows = [row('q4', 't4', 0), row('q5', 't5', 1), row('d', 'delivered into a turn', 2), row('q2', 't2', 3), row('q3', 't3', 4)]
    const turns = [1, 2, 3, 4, 5].map((n) => turn(`t${n}`, { tools: n }))
    const got = bindTurns(rows, turns)

    expect(brief(got.bars)).toEqual(['d:?', 'q2:2', 'q3:3', 'q4:4', 'q5:5'])
    expect(got.older).toBe(1)
  })

  test('a row without a turn at the bottom of a chunk drawn above earlier ones stands after the bound row before it', () => {
    // Q5 is drawn first, then the chunk above: Q3, Q4 and D, delivered into turn Q4.
    const rows = [row('q5', 't5', 0), row('q3', 't3', 1), row('q4', 't4', 2), row('d', 'delivered into a turn', 3)]
    const turns = [3, 4, 5].map((n) => turn(`t${n}`, { tools: n }))

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['q3:3', 'q4:4', 'd:?', 'q5:5'])
  })

  test('the transcript is capped: rows older than its first turn, drawn by scrolling up, are at the start of the rail', () => {
    // The transcript has turns 14–17; R17, then R14–R16, then R10–R13, which are older than the cap.
    const rows = [17, 14, 15, 16, 10, 11, 12, 13].map((n, i) => row(`r${n}`, `t${n}`, i))
    const turns = [14, 15, 16, 17].map((n) => turn(`t${n}`, { tools: n }))
    const capped = bindTurns(rows, turns, { isCapped: true })

    expect(brief(capped.bars)).toEqual(['r10:?', 'r11:?', 'r12:?', 'r13:?', 'r14:14', 'r15:15', 'r16:16', 'r17:17'])
    expect(capped.older).toBe(0)
    // The transcript is not capped: rows without a turn at the bottom of a chunk stand after the bound row before them.
    expect(brief(bindTurns(rows, turns).bars)).toEqual(['r14:14', 'r15:15', 'r16:16', 'r10:?', 'r11:?', 'r12:?', 'r13:?', 'r17:17'])
  })

  test('a prompt delivered into the previous turn stands after the row of that turn even if scrolling drew rows later', () => {
    // R5 is submitted, during its turn scrolling drew R3, then Q is delivered.
    const rows = [row('r4', 't4', 0), row('r5', 't5', 1), row('r3', 't3', 2), sent('q', 'and also consider', 3)]
    const turns = [3, 4, 5].map((n) => turn(`t${n}`, { tools: n }))

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['r3:3', 'r4:4', 'r5:5', 'q:?'])
  })

  test('the previous summary of a bar is kept when the binding is gone (/compact, the transcript cap)', () => {
    const rows = [row('a', 'first', 0), row('b', 'second', 1)]
    const before = bindTurns(rows, [turn('first', { tools: 1, edits: 1 }), turn('second', { tools: 2 })])
    const after = bindTurns(rows, [turn('second', { tools: 7 })], { previous: before.bars })

    expect(after.bars).toEqual([
      { id: 'a', text: 'first', summary: summary({ tools: 1, edits: 1 }) },
      { id: 'b', text: 'second', summary: summary({ tools: 7 }) },
    ])
  })

  test('the previous summary of another bar is not carried over; without a previous bar there is no summary', () => {
    const previous: Bar[] = [{ id: 'old', text: 'first', summary: summary({ tools: 9 }) }]

    expect(brief(bindTurns([row('a', 'first', 0)], [], { previous }).bars)).toEqual(['a:?'])
  })

  test('the bar text is taken from the row', () => {
    const got = bindTurns([{ id: 'a', key: textKey(PASTED), text: 'how many lines are in the paste? answer with a number', order: 0 }], [turn(PASTED)])

    expect(got.bars[0]?.text).toBe('how many lines are in the paste? answer with a number')
  })

  test('a text with a paste and with [Image #n] is bound', () => {
    const rows = [row('p', PASTED, 0), row('i', IMAGE, 1)]
    const turns = splitTurns([human(PASTED), reply('2'), human(IMAGE), tool('Read'), reply('cat')])

    expect(brief(bindTurns(rows, turns).bars)).toEqual(['p:0', 'i:1'])
  })

  test('whitespace at the edges and inside does not prevent binding', () => {
    expect(brief(bindTurns([row('a', 'yes,  go', 0)], [turn('  yes,\ngo\n', { tools: 1 })]).bars)).toEqual(['a:1'])
  })
})

describe('markSummary', () => {
  test('answer does not change the summary', () => {
    const plain = summary({ tools: 2 })

    expect(markSummary(plain, 'answer')).toBe(plain)
  })

  test('aborted is interrupted; error and refusal are an error, at least one', () => {
    expect(markSummary(summary(), 'aborted')).toEqual(summary({ interrupted: true }))
    expect(markSummary(summary(), 'error')).toEqual(summary({ errors: 1 }))
    expect(markSummary(summary({ tools: 3, errors: 2 }), 'refusal')).toEqual(summary({ tools: 3, errors: 2 }))
  })

  test('applying it again changes nothing', () => {
    const once = markSummary(summary({ tools: 1 }), 'error')

    expect(markSummary(once, 'error')).toEqual(once)
    expect(markSummary(markSummary(once, 'aborted'), 'aborted')).toEqual(summary({ tools: 1, errors: 1, interrupted: true }))
  })
})

describe('markBars', () => {
  const bars: Bar[] = [
    { id: 'a', text: 'first', summary: summary({ tools: 1 }) },
    { id: 'b', text: 'second', summary: summary() },
    { id: 'c', text: 'third', summary: null },
  ]

  test('the turn-end flag lands on the summary of its own bar', () => {
    const marks = new Map<string, TurnCompleteReason>([
      ['a', 'error'],
      ['b', 'aborted'],
    ])

    expect(markBars(bars, marks).map((bar) => bar.summary)).toEqual([
      summary({ tools: 1, errors: 1 }),
      summary({ interrupted: true }),
      null,
    ])
  })

  test('a bar without a flag, a bar without a summary and the answer flag stay as they are', () => {
    const marked = markBars(
      bars,
      new Map<string, TurnCompleteReason>([
        ['b', 'answer'],
        ['c', 'error'],
      ]),
    )

    expect(marked).toEqual(bars)
    expect(marked[0]).toBe(bars[0])
  })
})

describe('rewound', () => {
  const texts = (...names: string[]) => names.map((name) => turn(name))

  test('a rewind by two turns, then a new prompt: the rows of those turns and the prompt delivered into them are gone', () => {
    const rows = [
      row('r1', 't1', 0),
      row('r2', 't2', 1),
      row('r3', 't3', 2),
      row('r4', 't4', 3),
      { ...row('q4', 'and also consider', 4), isLive: true },
      row('r5', 't5', 5),
      { ...row('x', 'new', 6), isLive: true },
    ]
    const gone = rewound(rows, texts('t1', 't2', 't3', 't4', 't5'), texts('t1', 't2', 't3', 'new'))

    expect([...gone].sort()).toEqual(['q4', 'r4', 'r5'])
  })

  test('after claude --resume rows are seen bottom-up: the rewind is found by turns, not by order of appearance', () => {
    const rows = [17, 16, 15, 14, 13, 12, 11, 10].map((n, i) => row(`r${n}`, `t${n}`, i))
    const before = Array.from({ length: 18 }, (_, n) => turn(`t${n}`))
    const after = [...before.slice(0, 16), turn('new')]

    expect([...rewound([...rows, { ...row('x', 'new', 8), isLive: true }], before, after)].sort()).toEqual(['r16', 'r17'])
  })

  test('turns were only appended: not a rewind', () => {
    const rows = [row('a', 'first', 0), row('b', 'second', 1)]

    expect(rewound(rows, texts('first', 'second'), texts('first', 'second', 'third')).size).toBe(0)
  })

  test('the transcript cap at 4096 entries and /compact without old turns are not a rewind', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(`r${n}`, `t${n}`, n))

    expect(rewound(rows, texts('t1', 't2', 't3', 't4', 't5'), texts('t3', 't4', 't5', 't6')).size).toBe(0)
    expect(rewound(rows, texts('t1', 't2', 't3', 't4', 't5'), texts('t6')).size).toBe(0)
  })

  test('a cap after which the first turn matched by text is not a rewind: the newest turn is in place', () => {
    const rows = [row('d1', 'yes', 0), row('x', 'ex', 1), row('d2', 'yes', 2), row('y', 'why', 3)]

    expect(rewound(rows, texts('yes', 'ex', 'yes', 'why'), texts('yes', 'why', 'zed')).size).toBe(0)
  })

  test('a row without a turn after a new prompt submitted after the rewind stays', () => {
    // A rewind by one turn (t3), then "new" and prompt y, delivered into its turn.
    const rows = [row('r1', 't1', 0), row('r2', 't2', 1), row('r3', 't3', 2), sent('x', 'new', 3), sent('y', 'delivered', 4)]
    const gone = rewound(rows, texts('t1', 't2', 't3'), texts('t1', 't2', 'new'))

    expect([...gone]).toEqual(['r3'])
  })

  test('the first read and an empty past are not a rewind; a rewind to the very beginning is not recognised', () => {
    const rows = [row('a', 'first', 0), row('b', 'second', 1)]

    expect(rewound(rows, [], texts('first')).size).toBe(0)
    expect(rewound(rows, texts('first', 'second'), texts('new')).size).toBe(0)
  })
})
