export interface ToolSchemaView {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface ToolGroupConfig {
  readonly id: string
  readonly description?: string
  readonly aliases?: readonly string[]
  readonly include: readonly string[]
  readonly exclude?: readonly string[]
}

export interface SkillBindingConfig {
  readonly skill: string
  readonly groups: readonly string[]
}

export type ProgressiveMode = 'stable-proxy' | 'dynamic'

export interface ResolvedConfig {
  readonly mode: ProgressiveMode
  readonly toolName: string
  readonly dispatchToolName: string
  readonly alwaysVisible: readonly string[]
  readonly groups: readonly ToolGroupConfig[]
  readonly skillBindings: readonly SkillBindingConfig[]
  readonly maxResults: number
  readonly activationGroupLimit: number
  readonly maxActiveGroups: number
  readonly maxActiveToolTokens: number
  readonly retentionTurns: number
  readonly charactersPerToken: number
  readonly requireDiscovery: boolean
  readonly deferToolGuidance: boolean
}

export interface CatalogTool extends ToolSchemaView {
  readonly estimatedTokens: number
  readonly searchText: string
}

export interface ToolGroup {
  readonly id: string
  readonly description: string
  readonly aliases: readonly string[]
  readonly tools: readonly CatalogTool[]
  readonly estimatedTokens: number
  readonly searchText: string
}

export interface ToolCatalog {
  readonly tools: ReadonlyMap<string, CatalogTool>
  readonly groups: ReadonlyMap<string, ToolGroup>
  readonly toolToGroup: ReadonlyMap<string, string>
  readonly totalEstimatedTokens: number
}

export interface SearchMatch {
  readonly group: string
  readonly description: string
  readonly score: number
  readonly estimatedTokens: number
  readonly tools: readonly string[]
}

/** One exact deferred definition returned by stable-proxy discovery. */
export interface DeferredToolMatch extends ToolSchemaView {
  readonly group: string
  readonly score: number
  readonly estimatedTokens: number
}

/** One browsable deferred family listed by the stable-proxy status action. */
export interface DeferredGroupSummary {
  readonly id: string
  readonly description: string
  readonly tools: readonly string[]
}

export interface ProxySearchResultValue {
  readonly protocol: 'dsh-progressive-tools/v2'
  readonly mode: 'stable-proxy'
  readonly action: 'search' | 'status'
  readonly query: string
  readonly matches: readonly DeferredToolMatch[]
  /** Complete deferred family catalog, included by the status action. */
  readonly groups?: readonly DeferredGroupSummary[]
  readonly stableTools: readonly string[]
  readonly discoveredTools: readonly string[]
  readonly catalogTools: number
  readonly estimatedVisibleTokens: number
  readonly estimatedCatalogTokens: number
  readonly estimatedSavedTokens: number
  readonly instruction: string
}

export interface ActiveGroupState {
  readonly id: string
  readonly activatedAtTurn: number
  readonly lastUsedTurn: number
}

export interface StateSnapshot {
  readonly activeGroups: readonly ActiveGroupState[]
}

export interface SearchResultValue {
  readonly protocol: 'dsh-progressive-tools/v1'
  readonly action: 'search' | 'status' | 'reset'
  readonly query: string
  readonly matches: readonly SearchMatch[]
  readonly activatedGroups: readonly string[]
  readonly evictedGroups: readonly string[]
  readonly activeGroups: readonly string[]
  readonly activeTools: readonly string[]
  readonly estimatedActiveTokens: number
  readonly estimatedCatalogTokens: number
  readonly estimatedSavedTokens: number
  readonly catalogTools: number
  readonly state: StateSnapshot
}
