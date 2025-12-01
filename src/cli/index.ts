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
    console.log(chalk.bold('\n🤖 plod - Starting build monitoring...\n'))

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
      console.log(`Loading configuration from ${options.config}...`)
      const config = yield* loadConfigFrom(options.config)
      console.log(chalk.green('✓ Configuration loaded\n'))

      console.log('Configuration:')
      console.log(`  Poll interval: ${config.polling.intervalSeconds}s`)
      console.log(`  Max iterations: ${config.polling.maxIterations}`)
      console.log(`  Work command: ${config.work.command} ${config.work.args.join(' ')}\n`)

      // Start polling
      const poller = yield* PollerService
      const result = yield* poller.poll(config)

      // Print summary
      console.log('\n' + chalk.bold('='.repeat(60)))
      console.log(chalk.bold('Summary:'))
      console.log('='.repeat(60))
      console.log(`Total iterations: ${result.iterations.length}`)
      console.log(`Final status: ${result.finalStatus}`)
      console.log(
        `Max iterations reached: ${result.maxIterationsReached ? 'Yes' : 'No'}`
      )

      const workedCount = result.iterations.filter((i) => i.workedOn).length
      console.log(`Times Claude fixed issues: ${workedCount}`)

      if (result.finalStatus === 'success') {
        console.log(chalk.green('\n✓ Build succeeded!'))
      } else if (result.maxIterationsReached) {
        console.log(chalk.yellow('\n⚠ Max iterations reached'))
        process.exit(1)
      } else {
        console.log(chalk.red('\n✗ Build failed'))
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
        console.error(chalk.red('\n✗ Error:'), Cause.pretty(cause))
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
    console.log(chalk.bold('\n🔍 Validating configuration...\n'))

    const main = Effect.gen(function* () {
      const config = yield* loadConfigFrom(options.config)
      console.log(chalk.green('✓ Configuration is valid\n'))
      console.log('Configuration:')
      console.log(JSON.stringify(config, null, 2))
    })

    const runnable = Effect.provide(main, ConfigServiceLive)

    const result = await Effect.runPromiseExit(runnable)
    if (result._tag === 'Failure') {
      const cause = result.cause
      const error = Cause.failureOption(cause)

      if (error._tag === 'Some' && isConfigError(error.value)) {
        handleConfigError(error.value)
      } else {
        console.error(chalk.red('\n✗ Error:'), Cause.pretty(cause))
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

// Handle config errors with nice messages
function handleConfigError(error: ConfigError) {
  switch (error._tag) {
    case 'ConfigNotFoundError':
      console.error(chalk.red(`\n✗ Configuration file not found: ${error.path}`))
      console.error('\nCreate a plod.config.json file in your project root.')
      break
    case 'ConfigParseError':
      console.error(chalk.red(`\n✗ Failed to parse configuration: ${error.path}`))
      console.error('\nMake sure plod.config.json is valid JSON.')
      console.error('Error:', error.cause)
      break
    case 'ConfigValidationError':
      console.error(chalk.red(`\n✗ Configuration validation failed: ${error.path}`))
      console.error('\nConfiguration does not match expected schema.')
      console.error('Errors:', error.errors)
      break
    case 'ConfigAccessError':
      console.error(chalk.red(`\n✗ Failed to access configuration file: ${error.path}`))
      console.error('\nCheck file permissions and path.')
      console.error('Error:', error.cause)
      break
  }
}

program.parse()
