/**
 * Main polling service that orchestrates the build feedback loop
 */
import { Context, Effect, Layer, Schedule } from 'effect'
import type { PlodConfig } from '../schemas/config.ts'
import {
  ExecutorService,
  ExecutorServiceLive,
  type CommandExecutionError,
} from './executor.ts'
import {
  ClaudeWorkerService,
  ClaudeWorkerServiceLive,
  type ClaudeWorkerError,
} from './claude-worker.ts'

/**
 * Build status result
 */
export type BuildStatus = 'success' | 'failure' | 'pending'

/**
 * Result of a polling iteration
 */
export interface IterationResult {
  readonly iteration: number
  readonly status: BuildStatus
  readonly workedOn: boolean
  readonly timestamp: Date
}

/**
 * Final result of the polling process
 */
export interface PollingResult {
  readonly iterations: ReadonlyArray<IterationResult>
  readonly finalStatus: BuildStatus
  readonly maxIterationsReached: boolean
}

/**
 * Errors that can occur during polling
 */
export type PollerError = CommandExecutionError | ClaudeWorkerError

/**
 * Poller service interface
 */
export interface PollerService {
  /**
   * Start the main polling loop
   */
  readonly poll: (config: PlodConfig) => Effect.Effect<PollingResult, PollerError, never>
}

export const PollerService = Context.GenericTag<PollerService>('PollerService')

/**
 * Parse build status from command output using regex patterns
 *
 * Matches whole words or specific patterns to avoid false positives.
 * For example, "This is not a success" won't match "success".
 */
const parseBuildStatus = (output: string): BuildStatus => {
  const normalized = output.toLowerCase().trim()

  // Match success patterns (whole words)
  if (/\b(success|successful|passed|pass|ok)\b/.test(normalized)) {
    return 'success'
  }

  // Match failure patterns (whole words)
  if (/\b(fail(ure|ed)?|error|failed|broken)\b/.test(normalized)) {
    return 'failure'
  }

  // Match pending/running patterns (whole words)
  if (/\b(pending|running|in.?progress|building|queued)\b/.test(normalized)) {
    return 'pending'
  }

  // Default to pending if status is unclear
  return 'pending'
}

/**
 * Live implementation of PollerService
 */
export const PollerServiceLive = Layer.effect(
  PollerService,
  Effect.gen(function* () {
    const executor = yield* ExecutorService
    const claudeWorker = yield* ClaudeWorkerService

    const poll = (config: PlodConfig): Effect.Effect<PollingResult, PollerError> =>
      Effect.gen(function* () {
        const iterations: IterationResult[] = []
        let workIterationCount = 0
        const failureWaitSeconds = config.polling.intervalSeconds * 3
        const maxPollTimeMs = config.polling.maxPollTimeMinutes * 60 * 1000
        const startTime = Date.now()

        // Main polling loop
        while (true) {
          // Check if we've exceeded max polling time
          const elapsedTime = Date.now() - startTime
          if (elapsedTime > maxPollTimeMs) {
            console.log(
              JSON.stringify({
                event: 'max_poll_time_exceeded',
                elapsedMinutes: Math.floor(elapsedTime / 60000),
              })
            )
            const finalStatusResult = yield* executor.execute(config.commands.checkBuildStatus)
            const finalStatus = parseBuildStatus(finalStatusResult.stdout)
            return {
              iterations,
              finalStatus,
              maxIterationsReached: false,
            }
          }

          // Check build status
          const statusResult = yield* executor.execute(config.commands.checkBuildStatus)
          const status = parseBuildStatus(statusResult.stdout)
          console.log(JSON.stringify({ event: 'build_status', status }))

          if (status === 'success') {
            // Build succeeded, we're done!
            iterations.push({
              iteration: workIterationCount,
              status,
              workedOn: false,
              timestamp: new Date(),
            })
            console.log(JSON.stringify({ event: 'build_succeeded' }))
            return {
              iterations,
              finalStatus: status,
              maxIterationsReached: false,
            }
          }

          if (status === 'pending') {
            // Still building, wait and continue
            iterations.push({
              iteration: workIterationCount,
              status,
              workedOn: false,
              timestamp: new Date(),
            })
            yield* Effect.sleep(`${config.polling.intervalSeconds} seconds`)
            continue
          }

          // status === 'failure'
          // Check if we've hit max work iterations
          if (workIterationCount >= config.polling.maxWorkIterations) {
            console.log(
              JSON.stringify({
                event: 'max_work_iterations_reached',
                count: workIterationCount,
              })
            )
            return {
              iterations,
              finalStatus: status,
              maxIterationsReached: true,
            }
          }

          workIterationCount++
          console.log(
            JSON.stringify({
              event: 'work_iteration_start',
              iteration: workIterationCount,
              maxWorkIterations: config.polling.maxWorkIterations,
            })
          )

          console.log(
            JSON.stringify({
              event: 'build_failed',
              waitingForLogs: failureWaitSeconds,
            })
          )
          yield* Effect.sleep(`${failureWaitSeconds} seconds`)

          // Extract build failures
          // Note: This command may return non-zero exit code if failures exist, which is expected
          const failuresResult = yield* executor
            .execute(config.commands.checkBuildFailures)
            .pipe(
              Effect.catchTag('CommandExecutionError', (error) => {
                // If the command failed but produced output, use it anyway
                // (e.g., jk returns exit code 1 when failures are found)
                if (error.stdout || error.stderr) {
                  return Effect.succeed({
                    stdout: error.stdout,
                    stderr: error.stderr,
                    exitCode: error.exitCode,
                  })
                }
                // Otherwise, re-throw the error
                return Effect.fail(error)
              })
            )

          const failureDetails = failuresResult.stdout || failuresResult.stderr
          console.log(
            JSON.stringify({
              event: 'failures_extracted',
              detailsLength: failureDetails.length,
              detailsPreview: failureDetails.substring(0, 200),
            })
          )

          // Run Claude to fix the issues
          console.log(JSON.stringify({ event: 'claude_started' }))
          const workResult = yield* claudeWorker.work(config.work, failureDetails)
          console.log(
            JSON.stringify({
              event: 'claude_finished',
              success: workResult.success,
              outputLength: workResult.output.length,
            })
          )

          // Log Claude's output for debugging
          if (workResult.output) {
            console.log(JSON.stringify({ event: 'claude_output', output: workResult.output }))
          } else {
            console.log(
              JSON.stringify({
                event: 'claude_no_output',
                warning: 'Claude completed but produced no text output',
              })
            )
          }

          // Check if there are any changes to commit
          const gitStatusResult = yield* executor.execute('git status --porcelain')
          const hasChanges = gitStatusResult.stdout.trim().length > 0

          if (!hasChanges) {
            console.log(
              JSON.stringify({
                event: 'no_changes',
                message: 'Claude made no changes, skipping publish',
              })
            )
            iterations.push({
              iteration: workIterationCount,
              status,
              workedOn: false,
              timestamp: new Date(),
            })
            // Continue to next iteration without publishing
            yield* Effect.sleep(`${config.polling.intervalSeconds} seconds`)
            continue
          }

          iterations.push({
            iteration: workIterationCount,
            status,
            workedOn: true,
            timestamp: new Date(),
          })

          // Publish the fixes
          console.log(JSON.stringify({ event: 'publishing_changes' }))
          yield* executor.execute(config.commands.publish)
          console.log(JSON.stringify({ event: 'fixes_published' }))

          // Wait before checking status again
          yield* Effect.sleep(`${config.polling.intervalSeconds} seconds`)
        }
      })

    return PollerService.of({
      poll,
    })
  })
).pipe(Layer.provide(ExecutorServiceLive), Layer.provide(ClaudeWorkerServiceLive))
