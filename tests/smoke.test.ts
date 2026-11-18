import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { register } from '../hooks/register'

// `on` for calling `register` directly: records the events the mod hooks,
// together with the matcher (`{ component: 'AbovePrompt' }`), and returns a
// registration with `.catch`, like the real one.
function recordingOn(events: string[]): On {
  const on = (pattern: string, matcher: unknown) => {
    events.push(typeof matcher === 'function' ? pattern : `${pattern} ${JSON.stringify(matcher)}`)

    return { catch: () => {} }
  }

  return on as unknown as On
}

test('the module loads, register runs without errors', () => {
  const events: string[] = []

  expect(() => register(recordingOn(events), {})).not.toThrow()
  // The engine rejects the same `on` twice at load: every "event and matcher"
  // pair appears once.
  expect(new Set(events).size).toBe(events.length)
  expect(events).toEqual([
    'ui.render {"component":"UserMessage"}',
    'ui.render {"component":"AbovePrompt"}',
    'prompt.submit',
    'turn.start',
    'turn.complete',
    'session.start',
    'command.run {"command":["tail-feed","tail-feed-next","tail-feed-prev","tail-feed-toggle"]}',
    'session.end',
  ])
})

test('the engine admits the mod to load', async ($, on) => {
  const verdicts: Record<string, unknown> = {}

  // The verdict of the engine and the plugins above the test is what `next(e)` returned.
  on('plugin.register', async (_, e, next) => {
    const verdict = await next(e)
    verdicts[e.name] = verdict

    return verdict
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))

  // The first `$` call loads the plugins.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(verdicts['tail-feed']).toEqual({ allow: true })
})
