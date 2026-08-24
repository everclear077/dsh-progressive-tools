/**
 * Progressive discovery for the DeepSeek Harness tool registry.
 *
 * The plugin changes one agent-scoped visibility layer at pre-step boundaries.
 * It never mutates tool definitions and never changes another agent's view.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { buildCatalog, matchesToolName } from './catalog.js'
import {
  DEFAULT_ACTIVATION_GROUP_LIMIT,
  DEFAULT_ALWAYS_VISIBLE,
  DEFAULT_CHARACTERS_PER_TOKEN,
  DEFAULT_GROUPS,
  DEFAULT_MAX_ACTIVE_GROUPS,
  DEFAULT_MAX_ACTIVE_TOOL_TOKENS,
  DEFAULT_MAX_RESULTS,
  DEFAULT_RETENTION_TURNS,
  DEFAULT_SKILL_BINDINGS,
  DEFAULT_TOOL_NAME,
} from './defaults.js'
import {
  activateGroups,
  createProgressiveState,
  expireGroups,
  proposeSearch,
  restoreSnapshot,
  snapshotState,
  touchTool,
} from './state.js'
import type {
  ProgressiveState,
} from './state.js'
import type {
  ActiveGroupState,
  ResolvedConfig,
  SearchResultValue,
  SkillBindingConfig,
  StateSnapshot,
  ToolGroupConfig,
  ToolSchemaView,
} from './types.js'

export { buildCatalog, estimateSchemaTokens, searchCatalog } from './catalog.js'
export {
  activateGroups,
  createProgressiveState,
  expireGroups,
  proposeSearch,
  restoreSnapshot,
  snapshotState,
  touchTool,
} from './state.js'
export type {
  ActiveGroupState,
  CatalogTool,
  ResolvedConfig,
  SearchMatch,
  SearchResultValue,
  SkillBindingConfig,
  StateSnapshot,
  ToolCatalog,
  ToolGroup,
  ToolGroupConfig,
  ToolSchemaView,
} from './types.js'

export const name = 'progressive-tools'
export const inject = ['tools']

export interface Config {
  /** Registered discovery tool name. */
  readonly toolName?: string
  /** Tool-name wildcard patterns that stay visible without activation. */
  readonly alwaysVisible?: readonly string[]
  /** Ordered family rules. The first matching family owns a tool. */
  readonly groups?: readonly ToolGroupConfig[]
  /** Successful skill calls that should activate tool families. */
  readonly skillBindings?: readonly SkillBindingConfig[]
  /** Maximum search matches returned to the caller. */
  readonly maxResults?: number
  /** Highest-ranked families activated by one search. */
  readonly activationGroupLimit?: number
  /** Maximum retained active families. */
  readonly maxActiveGroups?: number
  /** Approximate schema-token budget for active families. */
  readonly maxActiveToolTokens?: number
  /** Turns of inactivity before an active family expires; zero disables expiry. */
  readonly retentionTurns?: number
  /** Schema characters represented by one estimated token. */
  readonly charactersPerToken?: number
}

const groupConfigSchema = z.object({
  id: z.string().required(),
  description: z.string(),
  aliases: z.array(z.string()).default([]),
  include: z.array(z.string()).required(),
  exclude: z.array(z.string()).default([]),
})

const skillBindingSchema = z.object({
  skill: z.string().required(),
  groups: z.array(z.string()).required(),
})

export const Config = z.object({
  toolName: z.string().default(DEFAULT_TOOL_NAME),
  alwaysVisible: z.array(z.string()).default([...DEFAULT_ALWAYS_VISIBLE]),
  groups: z.array(groupConfigSchema).default(DEFAULT_GROUPS.map(group => ({
    ...group,
    description: group.description ?? '',
    aliases: [...group.aliases ?? []],
    include: [...group.include],
    exclude: [...group.exclude ?? []],
  }))),
  skillBindings: z.array(skillBindingSchema).default([]),
  maxResults: z.number().default(DEFAULT_MAX_RESULTS),
  activationGroupLimit: z.number().default(DEFAULT_ACTIVATION_GROUP_LIMIT),
  maxActiveGroups: z.number().default(DEFAULT_MAX_ACTIVE_GROUPS),
  maxActiveToolTokens: z.number().default(DEFAULT_MAX_ACTIVE_TOOL_TOKENS),
  retentionTurns: z.number().default(DEFAULT_RETENTION_TURNS),
  charactersPerToken: z.number().default(DEFAULT_CHARACTERS_PER_TOKEN),
}) as unknown as z<Config>

function nonEmpty(value: string, path: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${path} must not be empty`)
  return trimmed
}

function integer(value: number, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${path} must be a safe integer greater than or equal to ${minimum}`)
  }
  return value
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const toolName = nonEmpty(config.toolName ?? DEFAULT_TOOL_NAME, 'toolName')
  const alwaysVisible = (config.alwaysVisible ?? DEFAULT_ALWAYS_VISIBLE)
    .map((pattern, index) => nonEmpty(pattern, `alwaysVisible[${index}]`))
  const groups = (config.groups ?? DEFAULT_GROUPS).map((group, index): ToolGroupConfig => {
    const description = group.description?.trim()
    return {
      id: nonEmpty(group.id, `groups[${index}].id`),
      ...(description === undefined || description === '' ? {} : { description }),
      aliases: (group.aliases ?? []).map((alias, aliasIndex) =>
        nonEmpty(alias, `groups[${index}].aliases[${aliasIndex}]`),
      ),
      include: group.include.map((pattern, patternIndex) =>
        nonEmpty(pattern, `groups[${index}].include[${patternIndex}]`),
      ),
      exclude: (group.exclude ?? []).map((pattern, patternIndex) =>
        nonEmpty(pattern, `groups[${index}].exclude[${patternIndex}]`),
      ),
    }
  })
  const groupIds = new Set<string>()
  for (const [index, group] of groups.entries()) {
    if (group.include.length === 0) throw new Error(`groups[${index}].include must not be empty`)
    if (groupIds.has(group.id)) throw new Error(`duplicate group id ${JSON.stringify(group.id)}`)
    groupIds.add(group.id)
  }
  const skillBindings = (config.skillBindings ?? DEFAULT_SKILL_BINDINGS).map((binding, index) => {
    const skill = nonEmpty(binding.skill, `skillBindings[${index}].skill`)
    if (binding.groups.length === 0) throw new Error(`skillBindings[${index}].groups must not be empty`)
    const boundGroups = binding.groups.map((group, groupIndex) =>
      nonEmpty(group, `skillBindings[${index}].groups[${groupIndex}]`),
    )
    for (const group of boundGroups) {
      if (!groupIds.has(group)) throw new Error(`skill binding ${JSON.stringify(skill)} names unknown group ${JSON.stringify(group)}`)
    }
    return { skill, groups: boundGroups }
  })
  const maxResults = integer(config.maxResults ?? DEFAULT_MAX_RESULTS, 'maxResults', 1)
  const activationGroupLimit = integer(
    config.activationGroupLimit ?? DEFAULT_ACTIVATION_GROUP_LIMIT,
    'activationGroupLimit',
    1,
  )
  const maxActiveGroups = integer(config.maxActiveGroups ?? DEFAULT_MAX_ACTIVE_GROUPS, 'maxActiveGroups', 1)
  if (activationGroupLimit > maxActiveGroups) {
    throw new Error('activationGroupLimit must not exceed maxActiveGroups')
  }
  return {
    toolName,
    alwaysVisible,
    groups,
    skillBindings,
    maxResults,
    activationGroupLimit,
    maxActiveGroups,
    maxActiveToolTokens: integer(
      config.maxActiveToolTokens ?? DEFAULT_MAX_ACTIVE_TOOL_TOKENS,
      'maxActiveToolTokens',
      1,
    ),
    retentionTurns: integer(config.retentionTurns ?? DEFAULT_RETENTION_TURNS, 'retentionTurns', 0),
    charactersPerToken: integer(
      config.charactersPerToken ?? DEFAULT_CHARACTERS_PER_TOKEN,
      'charactersPerToken',
      1,
    ),
  }
}

interface AgentState {
  readonly agent: Agent
  readonly progressive: ProgressiveState
  restriction: (() => void) | undefined
  restrictableNames: Set<string>
  eagerNames: Set<string>
  catalogDirty: boolean
  restored: boolean
}

interface LoggedCall {
  readonly name: string
  readonly arguments: unknown
  readonly turn: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function parseActiveGroup(value: unknown): ActiveGroupState | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !Number.isSafeInteger(value.activatedAtTurn)
    || !Number.isSafeInteger(value.lastUsedTurn)) return undefined
  return {
    id: value.id,
    activatedAtTurn: value.activatedAtTurn as number,
    lastUsedTurn: value.lastUsedTurn as number,
  }
}

function parseSnapshot(value: unknown): StateSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.activeGroups)) return undefined
  const activeGroups: ActiveGroupState[] = []
  for (const candidate of value.activeGroups) {
    const parsed = parseActiveGroup(candidate)
    if (parsed === undefined) return undefined
    activeGroups.push(parsed)
  }
  return { activeGroups }
}

function snapshotFromSearchValue(value: unknown): StateSnapshot | undefined {
  if (!isRecord(value) || value.protocol !== 'dsh-progressive-tools/v1') return undefined
  return parseSnapshot(value.state)
}

function textContentValue(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined
  const first = content[0]
  return isRecord(first) && first.type === 'text' ? parseJson(first.text) : undefined
}

function toolResultContent(message: unknown): { callId: string; isError: boolean; value: unknown } | undefined {
  if (!isRecord(message) || !isRecord(message.source) || typeof message.source.callId !== 'string') return undefined
  if (!Array.isArray(message.content) || !isRecord(message.content[0])) return undefined
  const block = message.content[0]
  if (block.type !== 'tool-result') return undefined
  return {
    callId: message.source.callId,
    isError: block.isError === true,
    value: textContentValue(block.content),
  }
}

function skillNameFromArguments(value: unknown): string | undefined {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) return undefined
  if (typeof parsed.name === 'string') return parsed.name
  if (typeof parsed.skill === 'string') return parsed.skill
  return undefined
}

function eventTurn(event: unknown): number {
  if (!isRecord(event) || !isRecord(event.data) || !Number.isSafeInteger(event.data.turn)) return 0
  return event.data.turn as number
}

function cloneSchemas(value: readonly { name: string; description: string; parameters: Record<string, unknown> }[]): ToolSchemaView[] {
  return value.map(schema => ({
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  }))
}

function stateMeta(value: SearchResultValue): JsonValue {
  return {
    protocol: value.protocol,
    state: value.state as unknown as JsonValue,
  }
}

const activeGroupSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    activatedAtTurn: { type: 'integer', required: true },
    lastUsedTurn: { type: 'integer', required: true },
  },
} as const

const searchResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    protocol: { type: 'string', enum: ['dsh-progressive-tools/v1'], required: true },
    action: { type: 'string', enum: ['search', 'status', 'reset'], required: true },
    query: { type: 'string', required: true },
    matches: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          group: { type: 'string', required: true },
          description: { type: 'string', required: true },
          score: { type: 'number', required: true },
          estimatedTokens: { type: 'integer', required: true },
          tools: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
    },
    activatedGroups: { type: 'array', items: { type: 'string' }, required: true },
    evictedGroups: { type: 'array', items: { type: 'string' }, required: true },
    activeGroups: { type: 'array', items: { type: 'string' }, required: true },
    activeTools: { type: 'array', items: { type: 'string' }, required: true },
    estimatedActiveTokens: { type: 'integer', required: true },
    estimatedCatalogTokens: { type: 'integer', required: true },
    estimatedSavedTokens: { type: 'integer', required: true },
    catalogTools: { type: 'integer', required: true },
    state: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        activeGroups: { type: 'array', items: activeGroupSchema, required: true },
      },
    },
  },
} as const

function resultValueFromExecution(result: Readonly<ToolExecutionResult>): SearchResultValue | undefined {
  if (result.isError || !isRecord(result.value) || result.value.protocol !== 'dsh-progressive-tools/v1') return undefined
  const snapshot = parseSnapshot(result.value.state)
  if (snapshot === undefined) return undefined
  return result.value as unknown as SearchResultValue
}

export function apply(ctx: Context, input: Config): void {
  const config = resolveConfig(input)
  const states = new WeakMap<Agent, AgentState>()
  const liveStates = new Set<AgentState>()
  const skillBindings = new Map(config.skillBindings.map(binding => [binding.skill, binding.groups] as const))
  let restrictionMutationDepth = 0

  const mutateRestriction = <T>(operation: () => T): T => {
    restrictionMutationDepth += 1
    try {
      return operation()
    } finally {
      restrictionMutationDepth -= 1
    }
  }

  const disposeRestriction = (state: AgentState): void => {
    const dispose = state.restriction
    state.restriction = undefined
    if (dispose !== undefined) mutateRestriction(dispose)
  }

  const latestTurn = (agent: Agent): number => agent.session.events.reduce(
    (maximum, event) => Math.max(maximum, eventTurn(event)),
    0,
  )

  const ensureState = (agent: Agent): AgentState => {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const created: AgentState = {
      agent,
      progressive: createProgressiveState(buildCatalog([], config.groups, config.charactersPerToken), latestTurn(agent)),
      restriction: undefined,
      restrictableNames: new Set(),
      eagerNames: new Set(),
      catalogDirty: true,
      restored: false,
    }
    states.set(agent, created)
    liveStates.add(created)
    return created
  }

  const applySkillBinding = (state: AgentState, argumentsValue: unknown, turn: number): void => {
    const skillName = skillNameFromArguments(argumentsValue)
    if (skillName === undefined) return
    const groups = skillBindings.get(skillName)
    if (groups !== undefined) activateGroups(state.progressive, groups, turn, config)
  }

  const restoreFromEvents = (state: AgentState): void => {
    const calls = new Map<string, LoggedCall>()
    for (const event of state.agent.session.events) {
      state.progressive.currentTurn = Math.max(state.progressive.currentTurn, eventTurn(event))
      if (event.type === 'tool/call') {
        calls.set(String(event.data.callId), {
          name: event.data.name,
          arguments: event.data.arguments,
          turn: event.data.turn,
        })
        continue
      }
      if (event.type === 'tool/result') {
        const result = toolResultContent(event.data.message)
        if (result === undefined || result.isError) continue
        const call = calls.get(result.callId)
        if (call === undefined) continue
        if (call.name === config.toolName) {
          const snapshot = isRecord(event.data.meta)
            ? snapshotFromSearchValue({ protocol: event.data.meta.protocol, state: event.data.meta.state })
            : undefined
          const fallback = snapshotFromSearchValue(result.value)
          if (snapshot !== undefined || fallback !== undefined) {
            restoreSnapshot(state.progressive, snapshot ?? fallback!)
          }
        } else if (call.name === 'skill') {
          applySkillBinding(state, call.arguments, call.turn)
        } else {
          touchTool(state.progressive, call.name, call.turn)
        }
        continue
      }
      if (event.type !== 'tool/code-dispatch') continue
      const nested = event.data
      if (nested.isError) continue
      if (nested.name === config.toolName) {
        const snapshot = snapshotFromSearchValue(textContentValue(nested.content))
        if (snapshot !== undefined) restoreSnapshot(state.progressive, snapshot)
      } else if (nested.name === 'skill') {
        applySkillBinding(state, nested.arguments, eventTurn(event))
      } else {
        touchTool(state.progressive, nested.name, eventTurn(event))
      }
    }
  }

  const rebuildCatalog = (state: AgentState): void => {
    const previous = snapshotState(state.progressive)
    disposeRestriction(state)
    const unrestricted = cloneSchemas(state.agent.ctx.tools.schemas(state.agent))
    const hideInherited = mutateRestriction(() => state.agent.ctx.tools.restrict({ allow: [] }))
    let ownNames: Set<string>
    try {
      ownNames = new Set(state.agent.ctx.tools.schemas(state.agent).map(schema => schema.name))
    } finally {
      mutateRestriction(hideInherited)
    }
    const restrictable = unrestricted.filter(schema => !ownNames.has(schema.name))
    const eagerNames = new Set(restrictable
      .filter(schema => schema.name === config.toolName || matchesToolName(schema.name, config.alwaysVisible))
      .map(schema => schema.name))
    const managed = restrictable.filter(schema => !eagerNames.has(schema.name))
    state.progressive.catalog = buildCatalog(managed, config.groups, config.charactersPerToken)
    state.restrictableNames = new Set(restrictable.map(schema => schema.name))
    state.eagerNames = eagerNames
    if (state.restored) restoreSnapshot(state.progressive, previous)
    else {
      restoreFromEvents(state)
      state.restored = true
    }
    state.catalogDirty = false
  }

  const installRestriction = (state: AgentState): void => {
    disposeRestriction(state)
    const allow = new Set(state.eagerNames)
    for (const groupId of state.progressive.active.keys()) {
      const group = state.progressive.catalog.groups.get(groupId)
      if (group === undefined) continue
      for (const tool of group.tools) {
        if (state.restrictableNames.has(tool.name)) allow.add(tool.name)
      }
    }
    state.restriction = mutateRestriction(() => state.agent.ctx.tools.restrict({ allow: [...allow].sort() }))
  }

  const prepareState = (agent: Agent, turn: number): AgentState => {
    const state = ensureState(agent)
    state.progressive.currentTurn = Math.max(state.progressive.currentTurn, turn)
    if (state.catalogDirty) rebuildCatalog(state)
    expireGroups(state.progressive, state.progressive.currentTurn, config)
    installRestriction(state)
    return state
  }

  ctx.tools.register(defineTool({
    name: config.toolName,
    description: 'Search the hidden tool catalog and activate only the relevant tool families for the next step. Use status to inspect active families or reset to release them.',
    parameters: {
      query: {
        type: 'string',
        description: 'Capability to find. Required for search; use task-oriented words such as browser, database, files, vision, or remote server.',
      },
      action: {
        type: 'string',
        enum: ['search', 'status', 'reset'],
        description: 'search activates matching families; status inspects; reset releases all activated families. Defaults to search.',
      },
      max_results: {
        type: 'integer',
        description: `Maximum matches to return, up to ${config.maxResults}.`,
      },
    },
    output: {
      schema: searchResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => stateMeta(value as unknown as SearchResultValue),
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error(`${config.toolName} requires an agent-scoped execution`)
      const state = ensureState(exec.agent)
      if (state.catalogDirty) rebuildCatalog(state)
      const action = args.action ?? 'search'
      const query = args.query?.trim() ?? ''
      if (action === 'search' && query === '') throw new Error('query is required when action is search')
      if (args.max_results !== undefined && (args.max_results < 1 || args.max_results > config.maxResults)) {
        throw new Error(`max_results must be between 1 and ${config.maxResults}`)
      }
      return proposeSearch(
        state.progressive,
        action,
        query,
        args.max_results ?? config.maxResults,
        config,
      ) as unknown as InferValue<typeof searchResultSchema>
    },
  }))

  ctx.on('agent/pre-step', async ({ agent, turn }, next): Promise<PreStepDecision> => {
    prepareState(agent, turn)
    return next()
  }, { prepend: true })

  ctx.on('tools/result', (exec, result) => {
    const agent = exec.agent
    if (agent === undefined || result.isError) return
    const state = ensureState(agent)
    if (exec.name === config.toolName) {
      const value = resultValueFromExecution(result)
      if (value !== undefined) restoreSnapshot(state.progressive, value.state)
      return
    }
    if (exec.name === 'skill') {
      applySkillBinding(state, exec.arguments, state.progressive.currentTurn)
      return
    }
    touchTool(state.progressive, exec.name, state.progressive.currentTurn)
  })

  ctx.on('tools/change', () => {
    if (restrictionMutationDepth > 0) return
    for (const state of liveStates) state.catalogDirty = true
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = states.get(agent)
    if (state === undefined) return
    disposeRestriction(state)
    states.delete(agent)
    liveStates.delete(state)
  })

  ctx.effect(() => () => {
    for (const state of liveStates) disposeRestriction(state)
    liveStates.clear()
  }, 'progressive-tools.agent-restrictions')
}
