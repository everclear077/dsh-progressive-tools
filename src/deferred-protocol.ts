/**
 * Host tool schemas on this baseline are name, description, and parameters.
 * A deferred-tool flag is not part of that public contract, so this plugin
 * does not invent one or put deferred tools back on the stable surface.
 */
export interface DeferredProtocolProbe {
  readonly supported: false
  readonly reason: string
}

const PUBLIC_SCHEMA_KEYS = new Set(['name', 'description', 'parameters'])

export function probeDeferredProtocol(schemaKeys: readonly string[]): DeferredProtocolProbe {
  const extra = schemaKeys.filter(key => !PUBLIC_SCHEMA_KEYS.has(key))
  if (extra.length === 0) {
    return {
      supported: false,
      reason: 'Host tool schemas expose name, description, and parameters. No public deferred-tool field is available.',
    }
  }
  return {
    supported: false,
    reason: `Schema fields ${extra.join(', ')} are not a documented deferred-tool protocol. stable-proxy remains the presentation path.`,
  }
}
