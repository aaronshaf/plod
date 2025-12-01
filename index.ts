/**
 * @aaronshaf/plod - CI build failure feedback loop automation
 *
 * This package provides both a CLI tool and programmatic API for automating
 * the CI build feedback loop with Claude Code Agent SDK.
 *
 * @module
 *
 * @example Basic programmatic usage
 * ```typescript
 * import { Effect } from 'effect'
 * import {
 *   ConfigServiceLive,
 *   PollerServiceLive,
 *   PollerService,
 *   loadConfig,
 * } from '@aaronshaf/plod'
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* loadConfig()
 *   const poller = yield* PollerService
 *   const result = yield* poller.poll(config)
 *   console.log('Final status:', result.finalStatus)
 * })
 *
 * const runnable = Effect.provide(
 *   program,
 *   Layer.mergeAll(ConfigServiceLive, PollerServiceLive)
 * )
 *
 * Effect.runPromise(runnable)
 * ```
 */

// ============================================================================
// Configuration Service
// ============================================================================

export {
  ConfigService,
  ConfigServiceLive,
  type ConfigService as ConfigServiceImpl,
  loadConfig,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  type ConfigError,
} from './src/services/config.ts'

// ============================================================================
// Executor Service
// ============================================================================

export {
  ExecutorService,
  ExecutorServiceLive,
  type ExecutorService as ExecutorServiceImpl,
  type CommandResult,
  CommandExecutionError,
} from './src/services/executor.ts'

// ============================================================================
// Claude Worker Service
// ============================================================================

export {
  ClaudeWorkerService,
  ClaudeWorkerServiceLive,
  type ClaudeWorkerService as ClaudeWorkerServiceImpl,
  type ClaudeWorkResult,
  ClaudeWorkerError,
} from './src/services/claude-worker.ts'

// ============================================================================
// Poller Service
// ============================================================================

export {
  PollerService,
  PollerServiceLive,
  type PollerService as PollerServiceImpl,
  type BuildStatus,
  type IterationResult,
  type PollingResult,
  type PollerError,
} from './src/services/poller.ts'

// ============================================================================
// Schemas
// ============================================================================

export {
  Commands,
  type Commands as CommandsType,
  WorkConfig,
  type WorkConfig as WorkConfigType,
  PollingConfig,
  type PollingConfig as PollingConfigType,
  PlodConfig,
  type PlodConfig as PlodConfigType,
  decode as decodeConfig,
  encode as encodeConfig,
} from './src/schemas/config.ts'
