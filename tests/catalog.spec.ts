import { describe, expect, it } from 'vitest'
import { buildCatalog, estimateSchemaTokens, matchingToolNames, searchCatalog } from '../src/catalog.js'
import type { ToolSchemaView } from '../src/types.js'

function schema(name: string, description: string): ToolSchemaView {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
  }
}

describe('tool catalog', () => {
  const schemas = [
    schema('browser_open', 'Open a web page'),
    schema('browser_click', 'Click a page element'),
    schema('db_query', 'Run a SQL query'),
    schema('db_tables', 'List database tables'),
    schema('standalone', 'Perform a unique operation'),
  ]
  const groups = [
    {
      id: 'browser',
      description: 'Browser navigation and interaction',
      aliases: ['web page', '浏览器'],
      include: ['browser_*'],
    },
    {
      id: 'database',
      description: 'Database queries and inspection',
      aliases: ['sql', '数据库'],
      include: ['db_*'],
    },
  ]

  it('assigns configured groups first and creates a singleton fallback', () => {
    const catalog = buildCatalog(schemas, groups, 4)

    expect([...catalog.groups.keys()]).toEqual(['browser', 'database', 'standalone'])
    expect(catalog.groups.get('browser')?.tools.map(tool => tool.name)).toEqual([
      'browser_open',
      'browser_click',
    ])
    expect(catalog.toolToGroup.get('standalone')).toBe('standalone')
    expect(catalog.totalEstimatedTokens).toBeGreaterThan(0)
  })

  it('ranks exact family and multilingual aliases ahead of description-only matches', () => {
    const catalog = buildCatalog(schemas, groups, 4)

    expect(searchCatalog(catalog, 'browser', 3)[0]?.group).toBe('browser')
    expect(searchCatalog(catalog, 'SQL', 3)[0]?.group).toBe('database')
    expect(searchCatalog(catalog, '数据库', 3)[0]?.group).toBe('database')
    expect(searchCatalog(catalog, '帮我检查数据库里的记录', 3)[0]?.group).toBe('database')
  })

  it('excludes eager tools from the managed catalog', () => {
    const catalog = buildCatalog(schemas, groups, 4, new Set(['standalone']))

    expect(catalog.tools.has('standalone')).toBe(false)
    expect(catalog.groups.has('standalone')).toBe(false)
  })

  it('honors exclusions, wildcard matching, and empty searches', () => {
    const catalog = buildCatalog(schemas, [{
      id: 'browser',
      include: ['browser_*'],
      exclude: ['browser_click'],
    }], 4)

    expect(catalog.groups.get('browser')?.tools.map(tool => tool.name)).toEqual(['browser_open'])
    expect(matchingToolNames(catalog, ['db_*'])).toEqual(['db_query', 'db_tables'])
    expect(searchCatalog(catalog, 'capability-that-does-not-exist', 3)).toEqual([])
  })

  it('groups repeated unmatched prefixes and avoids configured ID collisions', () => {
    const catalog = buildCatalog(schemas, [{ id: 'db', include: ['standalone'] }], 4)

    expect(catalog.groups.has('db')).toBe(true)
    expect(catalog.groups.has('auto:db')).toBe(true)
    expect(catalog.groups.get('auto:db')?.tools).toHaveLength(2)
  })

  it('uses the configured character ratio for deterministic estimates', () => {
    const candidate = schema('echo', 'Echo a value')

    expect(estimateSchemaTokens(candidate, 2)).toBeGreaterThan(estimateSchemaTokens(candidate, 8))
    expect(estimateSchemaTokens(candidate, 4)).toBe(Math.ceil(JSON.stringify(candidate).length / 4))
  })
})
