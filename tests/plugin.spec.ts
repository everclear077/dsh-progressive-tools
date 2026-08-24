import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as ProgressiveTools from '../src/index.js'
import type { Config as ProgressiveConfig } from '../src/index.js'

const signal = new AbortController().signal
function tool(name: string) {
  return defineTool({
    name,
    description: `${name} fixture`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async () => `ran:${name}`,
  })
}

async function setup(
  session = Session.create(SessionId('progressive-agent')),
  overrides: ProgressiveConfig = {},
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  for (const name of ['browser_open', 'browser_click', 'db_query', 'skill', 'ask_user_question']) {
    ctx.tools.register(tool(name))
  }
  const plugin = ctx.plugin(ProgressiveTools, {
    groups: [
      { id: 'browser', include: ['browser_*'], description: 'Browser tools' },
      { id: 'database', include: ['db_*'], description: 'Database tools' },
    ],
    maxActiveGroups: 1,
    maxActiveToolTokens: 10_000,
    retentionTurns: 10,
    ...overrides,
  })
  await plugin

  const agent = {} as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, agent)
  }, { inject: ['tools', 'systemPrompt'] }))
  Object.assign(agent, {
    id: session.id,
    session,
    ctx: scope.ctx,
  })
  scope.ctx.tools.register(tool('report'))
  return { agent, ctx, plugin, scope }
}

async function preStep(ctx: Context, agent: Agent, turn: number, step: number): Promise<void> {
  await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn, step, signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

async function execute(ctx: Context, agent: Agent, name: string, argumentsValue: unknown, callId: string) {
  return ctx.tools.execute({
    signal,
    callId: CallId(callId),
    name,
    arguments: argumentsValue,
    agent,
  })
}

describe('progressive tools plugin', () => {
  it('keeps eager and agent-owned tools, activates one family, and resets it', async () => {
    const { agent, ctx } = await setup()
    await preStep(ctx, agent, 1, 1)

    expect(ctx.tools.schemas(agent).map(schema => schema.name).sort()).toEqual([
      'ask_user_question',
      'report',
      'skill',
      'tool_search',
    ])
    expect((await execute(ctx, agent, 'browser_open', {}, 'hidden')).isError).toBe(true)

    const search = await execute(ctx, agent, 'tool_search', { query: 'browser navigation' }, 'search')
    expect(search.isError).toBe(false)
    await preStep(ctx, agent, 1, 2)
    expect(ctx.tools.schemas(agent).map(schema => schema.name).sort()).toEqual([
      'ask_user_question',
      'browser_click',
      'browser_open',
      'report',
      'skill',
      'tool_search',
    ])
    expect((await execute(ctx, agent, 'browser_open', {}, 'visible')).isError).toBe(false)

    await execute(ctx, agent, 'tool_search', { action: 'reset' }, 'reset')
    await preStep(ctx, agent, 1, 3)
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).not.toContain('browser_open')
  })

  it('unwinds its scoped restriction when the plugin unloads', async () => {
    const { agent, ctx, plugin } = await setup()
    await preStep(ctx, agent, 1, 1)
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).not.toContain('db_query')

    await plugin.dispose()

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('db_query')
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).not.toContain('tool_search')
  })

  it('restores active families from a durable top-level result projection', async () => {
    const session = Session.create(SessionId('restored-direct'))
    const callId = CallId('restore-search')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'tool_search',
      arguments: JSON.stringify({ query: 'browser' }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: '{}' }],
        isError: false,
      }),
      meta: {
        protocol: 'dsh-progressive-tools/v1',
        state: {
          activeGroups: [{ id: 'browser', activatedAtTurn: 1, lastUsedTurn: 1 }],
        },
      },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const { agent, ctx } = await setup(session)
    await preStep(ctx, agent, 2, 1)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('browser_open')
  })

  it('restores active families from a nested dispatch result', async () => {
    const session = Session.create(SessionId('restored-nested'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/code-dispatch', {
      rootCallId: CallId('root'),
      parentCallId: CallId('parent'),
      subCallId: CallId('nested-search'),
      name: 'tool_search',
      arguments: { query: 'browser' },
      isError: false,
      content: [{
        type: 'text',
        text: JSON.stringify({
          protocol: 'dsh-progressive-tools/v1',
          state: {
            activeGroups: [{ id: 'browser', activatedAtTurn: 1, lastUsedTurn: 1 }],
          },
        }),
      }],
    })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const { agent, ctx } = await setup(session)
    await preStep(ctx, agent, 2, 1)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('browser_click')
  })

  it('activates configured families after a successful skill call', async () => {
    const { agent, ctx } = await setup(undefined, {
      groups: [
        { id: 'browser', include: ['browser_*'] },
        { id: 'database', include: ['db_*'] },
      ],
      skillBindings: [{ skill: 'browser-operations', groups: ['browser'] }],
    })
    await preStep(ctx, agent, 1, 1)
    await execute(ctx, agent, 'skill', { name: 'browser-operations' }, 'skill')
    await preStep(ctx, agent, 1, 2)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('browser_open')
  })

  it('refreshes active families after dynamic tool registration', async () => {
    const { agent, ctx } = await setup()
    await preStep(ctx, agent, 1, 1)
    await execute(ctx, agent, 'tool_search', { query: 'browser' }, 'activate')
    await preStep(ctx, agent, 1, 2)
    ctx.tools.register(tool('browser_new'))
    await preStep(ctx, agent, 1, 3)

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('browser_new')
  })

  it('contains invalid search calls and releases state on agent disposal', async () => {
    const { agent, ctx } = await setup()
    await preStep(ctx, agent, 1, 1)

    expect((await execute(ctx, agent, 'tool_search', {}, 'empty-query')).isError).toBe(true)
    expect((await execute(ctx, agent, 'tool_search', { query: 'browser', max_results: 99 }, 'bad-limit')).isError).toBe(true)
    expect((await ctx.tools.execute({
      signal,
      callId: CallId('unscoped'),
      name: 'tool_search',
      arguments: { action: 'status' },
    })).isError).toBe(true)

    agentEvents(ctx, agent).emit('agent/disposed', {})
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toContain('db_query')
  })

  it('fails configuration with duplicate families or invalid limits', () => {
    expect(() => ProgressiveTools.resolveConfig({
      groups: [
        { id: 'same', include: ['a'] },
        { id: 'same', include: ['b'] },
      ],
    })).toThrow(/duplicate group id/)
    expect(() => ProgressiveTools.resolveConfig({
      activationGroupLimit: 2,
      maxActiveGroups: 1,
    })).toThrow(/must not exceed/)
    expect(() => ProgressiveTools.resolveConfig({ toolName: ' ' })).toThrow(/must not be empty/)
    expect(() => ProgressiveTools.resolveConfig({ groups: [{ id: 'empty', include: [] }] })).toThrow(/include must not be empty/)
    expect(() => ProgressiveTools.resolveConfig({ maxResults: 0 })).toThrow(/safe integer/)
    expect(() => ProgressiveTools.resolveConfig({
      groups: [{ id: 'browser', include: ['browser_*'] }],
      skillBindings: [{ skill: 'x', groups: ['missing'] }],
    })).toThrow(/unknown group/)
  })
})
