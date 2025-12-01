#!/usr/bin/env bun
/**
 * plod CLI - CI build failure feedback loop automation
 */
import { Command } from 'commander'
import { Effect, Layer, Cause } from 'effect'
import chalk from 'chalk'
import { ConfigServiceLive, type ConfigError } from '../services/config.ts'
import { ExecutorServiceLive } from '../services/executor.ts'
import { ClaudeWorkerServiceLive } from '../services/claude-worker.ts'
import { PollerServiceLive, PollerService } from '../services/poller.ts'
import { loadConfig, loadConfigFrom } from '../services/config.ts'

const program = new Command()

program
  .name('plod')
  .description('CI build failure feedback loop automation with Claude Code Agent SDK')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to plod.config.json', 'plod.config.json')

// Define the main start action
const startAction = async (options: { config: string }) => {
    // Build the Effect layer stack
    const AppLive = Layer.mergeAll(
      ConfigServiceLive,
      ExecutorServiceLive,
      ClaudeWorkerServiceLive,
      PollerServiceLive
    )

    // Main program
    const main = Effect.gen(function* () {
      // Load configuration from specified path
      const config = yield* loadConfigFrom(options.config)
      console.log(
        JSON.stringify({
          event: 'config_loaded',
          intervalSeconds: config.polling.intervalSeconds,
          maxIterations: config.polling.maxIterations,
        })
      )

      // Start polling
      const poller = yield* PollerService
      const result = yield* poller.poll(config)

      // Print summary
      const workedCount = result.iterations.filter((i) => i.workedOn).length
      console.log(
        JSON.stringify({
          event: 'summary',
          totalIterations: result.iterations.length,
          finalStatus: result.finalStatus,
          maxIterationsReached: result.maxIterationsReached,
          claudeFixCount: workedCount,
        })
      )

      if (result.finalStatus === 'success') {
        console.log(JSON.stringify({ event: 'success' }))
      } else if (result.maxIterationsReached) {
        console.log(JSON.stringify({ event: 'max_iterations_exceeded' }))
        process.exit(1)
      } else {
        console.log(JSON.stringify({ event: 'failed' }))
        process.exit(1)
      }
    })

    // Run the program
    const runnable = Effect.provide(main, AppLive)

    const result = await Effect.runPromiseExit(runnable)
    if (result._tag === 'Failure') {
      const cause = result.cause
      const error = Cause.failureOption(cause)

      if (error._tag === 'Some' && isConfigError(error.value)) {
        handleConfigError(error.value)
      } else {
        console.log(
          JSON.stringify({
            event: 'error',
            error: Cause.pretty(cause),
          })
        )
      }
      process.exit(1)
    }
}

// Set as default action (when no command specified)
program.action(startAction)

// Also available as explicit "start" command
program
  .command('start')
  .description('Start monitoring build status and automatically fix failures')
  .option('-c, --config <path>', 'Path to plod.config.json', 'plod.config.json')
  .action(startAction)

program
  .command('validate')
  .description('Validate plod.config.json without running')
  .option('-c, --config <path>', 'Path to plod.config.json', 'plod.config.json')
  .action(async (options) => {
    const main = Effect.gen(function* () {
      const config = yield* loadConfigFrom(options.config)
      console.log(
        JSON.stringify({
          event: 'config_valid',
          config,
        })
      )
    })

    const runnable = Effect.provide(main, ConfigServiceLive)

    const result = await Effect.runPromiseExit(runnable)
    if (result._tag === 'Failure') {
      const cause = result.cause
      const error = Cause.failureOption(cause)

      if (error._tag === 'Some' && isConfigError(error.value)) {
        handleConfigError(error.value)
      } else {
        console.log(
          JSON.stringify({
            event: 'error',
            error: Cause.pretty(cause),
          })
        )
      }
      process.exit(1)
    }
  })

// Helper to check if error is a ConfigError
function isConfigError(error: unknown): error is ConfigError {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    [
      'ConfigNotFoundError',
      'ConfigParseError',
      'ConfigValidationError',
      'ConfigAccessError',
    ].includes((error as { _tag: string })._tag)
  )
}

// Handle config errors with JSON Lines
function handleConfigError(error: ConfigError) {
  switch (error._tag) {
    case 'ConfigNotFoundError':
      console.log(
        JSON.stringify({
          event: 'error',
          type: 'config_not_found',
          path: error.path,
        })
      )
      break
    case 'ConfigParseError':
      console.log(
        JSON.stringify({
          event: 'error',
          type: 'config_parse_error',
          path: error.path,
          cause: String(error.cause),
        })
      )
      break
    case 'ConfigValidationError':
      console.log(
        JSON.stringify({
          event: 'error',
          type: 'config_validation_error',
          path: error.path,
          errors: String(error.errors),
        })
      )
      break
    case 'ConfigAccessError':
      console.log(
        JSON.stringify({
          event: 'error',
          type: 'config_access_error',
          path: error.path,
          cause: String(error.cause),
        })
      )
      break
  }
}

program.parse()
