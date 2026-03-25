// SPDX-License-Identifier: Apache-2.0

export interface CodexNativeBridgeStdioModules {
  mcpServerModulePath: string
  stdioServerTransportModulePath: string
  zodModulePath: string
}

export function buildCodexNativeBridgeStdioScript(modules: CodexNativeBridgeStdioModules): string {
  return `#!/usr/bin/env node
const { McpServer } = require(${JSON.stringify(modules.mcpServerModulePath)})
const { StdioServerTransport } = require(${JSON.stringify(modules.stdioServerTransportModulePath)})
const { z } = require(${JSON.stringify(modules.zodModulePath)})

async function main() {
  const bridgeUrl = process.env.OPENCOW_CODEX_BRIDGE_URL
  const bridgeToken = process.env.OPENCOW_CODEX_BRIDGE_TOKEN
  const sessionId = process.env.OPENCOW_CODEX_BRIDGE_SESSION_ID

  if (!bridgeUrl || !bridgeToken || !sessionId) {
    console.error('Missing required OpenCow bridge environment variables')
    process.exit(1)
  }

  async function request(path, init = {}) {
    const response = await fetch(\`\${bridgeUrl}\${path}\`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-opencow-bridge-token': bridgeToken,
        ...(init.headers || {}),
      },
    })
    const text = await response.text()
    let payload = {}
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { error: text }
      }
    }
    if (!response.ok) {
      let message = \`HTTP \${response.status}\`
      if (typeof payload.error === 'string') {
        message = payload.error
      } else if (payload.error && typeof payload.error === 'object') {
        const errorMessage = typeof payload.error.message === 'string' ? payload.error.message : null
        const errorCode = typeof payload.error.code === 'string' ? payload.error.code : null
        if (errorMessage && errorCode) {
          message = \`\${errorCode}: \${errorMessage}\`
        } else if (errorMessage) {
          message = errorMessage
        }
      }
      throw new Error(message)
    }
    return payload
  }

  const list = await request(\`/codex-native/list-tools?sessionId=\${encodeURIComponent(sessionId)}\`)
  const server = new McpServer({ name: 'opencow-capabilities', version: '1.0.0' })

  function asRecord(value) {
    return value && typeof value === 'object' ? value : {}
  }

  function firstStringCandidate(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }

  function pickString(extra, keys) {
    for (const key of keys) {
      const value = firstStringCandidate(extra[key])
      if (value) return value
    }
    return undefined
  }

  function readNestedRecord(extra, key) {
    return asRecord(extra[key])
  }

  function extractToolUseId(extra) {
    return (
      pickString(extra, ['tool_use_id', 'toolUseId', 'toolUseID']) ||
      pickString(readNestedRecord(extra, 'request'), ['tool_use_id', 'toolUseId', 'id']) ||
      pickString(readNestedRecord(extra, 'requestInfo'), ['tool_use_id', 'toolUseId', 'id']) ||
      pickString(readNestedRecord(extra, 'context'), ['tool_use_id', 'toolUseId'])
    )
  }

  function extractInvocationId(extra) {
    return (
      pickString(extra, ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ||
      pickString(readNestedRecord(extra, 'request'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ||
      pickString(readNestedRecord(extra, 'requestInfo'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ||
      pickString(readNestedRecord(extra, 'context'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id'])
    )
  }

  function applyDescription(schema, node) {
    if (!node || typeof node.description !== 'string' || !node.description) return schema
    if (!schema || typeof schema.describe !== 'function') return schema
    return schema.describe(node.description)
  }

  function literalUnion(values) {
    const literals = values.map((value) => z.literal(value))
    if (literals.length === 0) return z.any()
    if (literals.length === 1) return literals[0]
    return z.union(literals)
  }

  function normalizeSchemaNode(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return {}
    return node
  }

  function withNumberConstraints(schema, node) {
    let current = schema
    if (typeof node.minimum === 'number') current = current.gte(node.minimum)
    if (typeof node.maximum === 'number') current = current.lte(node.maximum)
    if (typeof node.exclusiveMinimum === 'number') current = current.gt(node.exclusiveMinimum)
    if (typeof node.exclusiveMaximum === 'number') current = current.lt(node.exclusiveMaximum)
    if (typeof node.multipleOf === 'number' && Number.isFinite(node.multipleOf) && node.multipleOf > 0) {
      current = current.multipleOf(node.multipleOf)
    }
    return current
  }

  function withStringConstraints(schema, node) {
    let current = schema
    if (typeof node.minLength === 'number') current = current.min(node.minLength)
    if (typeof node.maxLength === 'number') current = current.max(node.maxLength)
    if (typeof node.pattern === 'string' && node.pattern.length > 0) {
      try {
        current = current.regex(new RegExp(node.pattern))
      } catch {}
    }
    return current
  }

  function withArrayConstraints(schema, node) {
    let current = schema
    if (typeof node.minItems === 'number') current = current.min(node.minItems)
    if (typeof node.maxItems === 'number') current = current.max(node.maxItems)
    return current
  }

  function inferUnionSchemas(rawSchemas) {
    if (!Array.isArray(rawSchemas) || rawSchemas.length === 0) return null
    const branches = rawSchemas.map((branch) => inferSchemaFromJsonSchema(branch))
    if (branches.length === 1) return branches[0]
    return z.union(branches)
  }

  function inferAllOfSchema(rawSchemas) {
    if (!Array.isArray(rawSchemas) || rawSchemas.length === 0) return null
    let current = inferSchemaFromJsonSchema(rawSchemas[0])
    for (let i = 1; i < rawSchemas.length; i++) {
      current = z.intersection(current, inferSchemaFromJsonSchema(rawSchemas[i]))
    }
    return current
  }

  function inferSchemaFromJsonSchema(rawNode) {
    const node = normalizeSchemaNode(rawNode)
    if ('const' in node) {
      return applyDescription(z.literal(node.const), node)
    }

    const enumValues = Array.isArray(node.enum) ? node.enum : null
    if (enumValues && enumValues.length > 0) {
      return applyDescription(literalUnion(enumValues), node)
    }

    const oneOfSchema = inferUnionSchemas(node.oneOf)
    if (oneOfSchema) return applyDescription(oneOfSchema, node)

    const anyOfSchema = inferUnionSchemas(node.anyOf)
    if (anyOfSchema) return applyDescription(anyOfSchema, node)

    const allOfSchema = inferAllOfSchema(node.allOf)
    if (allOfSchema) return applyDescription(allOfSchema, node)

    if (Array.isArray(node.type) && node.type.length > 0) {
      const branches = node.type.map((typeValue) => inferSchemaFromJsonSchema({ ...node, type: typeValue }))
      return applyDescription(branches.length === 1 ? branches[0] : z.union(branches), node)
    }

    switch (node.type) {
      case 'string': {
        const stringSchema = withStringConstraints(z.string(), node)
        return applyDescription(stringSchema, node)
      }
      case 'number': {
        const numberSchema = withNumberConstraints(z.number(), node)
        return applyDescription(numberSchema, node)
      }
      case 'integer': {
        const intSchema = withNumberConstraints(z.number().int(), node)
        return applyDescription(intSchema, node)
      }
      case 'boolean':
        return applyDescription(z.boolean(), node)
      case 'null':
        return applyDescription(z.null(), node)
      case 'array': {
        const itemSchema = inferSchemaFromJsonSchema(node.items)
        const arraySchema = withArrayConstraints(z.array(itemSchema), node)
        return applyDescription(arraySchema, node)
      }
      case 'object':
      default: {
        const shape = {}
        const properties =
          node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)
            ? node.properties
            : {}
        const required = new Set(Array.isArray(node.required) ? node.required.filter((v) => typeof v === 'string') : [])
        for (const [key, propNode] of Object.entries(properties)) {
          const propertySchema = inferSchemaFromJsonSchema(propNode)
          shape[key] = required.has(key) ? propertySchema : propertySchema.optional()
        }
        let objectSchema = z.object(shape)
        if (node.additionalProperties === false) {
          objectSchema = objectSchema.strict()
        } else if (node.additionalProperties === true) {
          objectSchema = objectSchema.passthrough()
        } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
          // In JSON Schema, an empty schema object {} means "accept any value",
          // so additionalProperties: {} is equivalent to additionalProperties: true.
          const apKeys = Object.keys(node.additionalProperties)
          if (apKeys.length === 0) {
            objectSchema = objectSchema.passthrough()
          } else {
            objectSchema = objectSchema.catchall(inferSchemaFromJsonSchema(node.additionalProperties))
          }
        } else {
          // additionalProperties absent — default to strict for defense-in-depth
          // (bridge tools always emit an explicit value via z.toJSONSchema)
          objectSchema = objectSchema.strict()
        }
        return applyDescription(objectSchema, node)
      }
    }
  }

  for (const item of Array.isArray(list.tools) ? list.tools : []) {
    if (!item || typeof item.name !== 'string') continue
    const description = typeof item.description === 'string' ? item.description : ''
    const inputSchema = inferSchemaFromJsonSchema(item.inputSchema)
    server.registerTool(
      item.name,
      { description, inputSchema },
      async (args, extra) => {
        const extraObj = asRecord(extra)
        const toolUseId = extractToolUseId(extraObj)
        const invocationId = extractInvocationId(extraObj) || toolUseId
        try {
          const payload = await request('/codex-native/call-tool', {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              name: item.name,
              args,
              toolUseId,
              invocationId,
            }),
          })
          if (payload && typeof payload === 'object' && 'result' in payload) {
            return payload.result
          }
          return {
            isError: true,
            content: [{ type: 'text', text: 'OpenCow bridge returned an invalid tool response' }],
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            isError: true,
            content: [{ type: 'text', text: \`Bridge error: \${message}\` }],
          }
        }
      },
    )
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack || err.message) : String(err)
  console.error(message)
  process.exit(1)
})
`
}
