/**
 * Effect Schema definitions for plod configuration
 */
import { Schema } from '@effect/schema'

/**
 * Commands configuration - shell commands that plod will execute
 */
export const Commands = Schema.Struct({
  publish: Schema.String.pipe(
    Schema.annotations({
      description: 'Command to publish changes (e.g., git push to gerrit)',
    })
  ),
  checkBuildStatus: Schema.String.pipe(
    Schema.annotations({
      description:
        'Command to check build status - should output "success", "failure", or "pending"',
    })
  ),
  checkBuildFailures: Schema.String.pipe(
    Schema.annotations({ description: 'Command to extract build failure details' })
  ),
})

export type Commands = Schema.Schema.Type<typeof Commands>

/**
 * Work command configuration - Claude Code Agent SDK invocation
 */
export const WorkConfig = Schema.Struct({
  command: Schema.String.pipe(
    Schema.annotations({ description: 'Command to execute (typically "claude")' })
  ),
  args: Schema.Array(Schema.String).pipe(
    Schema.annotations({ description: 'Arguments to pass to the work command' })
  ),
})

export type WorkConfig = Schema.Schema.Type<typeof WorkConfig>

/**
 * Polling configuration
 */
export const PollingConfig = Schema.Struct({
  intervalSeconds: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.annotations({ description: 'Seconds to wait between status checks' })
  ),
  maxPollTimeMinutes: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.annotations({ description: 'Maximum minutes to wait for build to complete' })
  ),
  maxWorkIterations: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.annotations({ description: 'Maximum number of fix-and-republish cycles' })
  ),
})

export type PollingConfig = Schema.Schema.Type<typeof PollingConfig>

/**
 * Main plod configuration
 */
export const PlodConfig = Schema.Struct({
  commands: Commands,
  work: WorkConfig,
  polling: PollingConfig,
})

export type PlodConfig = Schema.Schema.Type<typeof PlodConfig>

/**
 * Decode and validate a plod configuration
 */
export const decode = Schema.decodeUnknownSync(PlodConfig)

/**
 * Encode a plod configuration back to plain object
 */
export const encode = Schema.encodeSync(PlodConfig)
