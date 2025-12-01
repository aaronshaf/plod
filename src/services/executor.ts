/**
 * Service for executing shell commands
 *
 * ⚠️ SECURITY WARNING: This service executes commands via shell ('sh -c'),
 * which allows shell features (pipes, redirects, variable expansion) but also
 * means commands must be trusted. Never pass unsanitized user input to this
 * service as it could lead to command injection vulnerabilities.
 *
 * Safe usage:
 * - Commands from config files (plod.config.json)
 * - Commands from trusted sources
 * - Hardcoded commands in your application
 *
 * Unsafe usage:
 * - Commands containing user input without validation
 * - Commands constructed from external API responses
 * - Commands with untrusted variable substitution
 */
import { Context, Effect, Layer, Duration } from 'effect'

/**
 * Default command timeout in minutes
 */
const DEFAULT_COMMAND_TIMEOUT_MINUTES = 5

/**
 * Result of executing a command
 */
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/**
 * Error executing a command
 */
export class CommandExecutionError {
  readonly _tag = 'CommandExecutionError'
  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly stderr: string
  ) {}
}

/**
 * Executor service interface
 */
export interface ExecutorService {
  /**
   * Execute a shell command and return the result.
   *
   * ⚠️ SECURITY: Commands are executed via 'sh -c', which allows shell features
   * but is vulnerable to command injection. Only use with trusted command strings.
   *
   * @param command - Shell command string to execute
   * @returns Effect that succeeds with CommandResult or fails with CommandExecutionError
   *
   * @example
   * ```typescript
   * // Safe: hardcoded command
   * executor.execute('git status')
   *
   * // Safe: config file command
   * executor.execute(config.commands.checkBuildStatus)
   *
   * // UNSAFE: user input without validation
   * executor.execute(`grep ${userInput} file.txt`) // ❌ Command injection risk!
   * ```
   */
  readonly execute: (
    command: string
  ) => Effect.Effect<CommandResult, CommandExecutionError, never>

  /**
   * Execute a command with separate arguments (safer than execute).
   *
   * Arguments are passed as separate parameters to the command, which provides
   * better protection against shell injection compared to concatenating a command string.
   *
   * @param command - Command name/path
   * @param args - Array of arguments
   * @returns Effect that succeeds with CommandResult or fails with CommandExecutionError
   *
   * @example
   * ```typescript
   * // Safer: args are separate, no shell expansion
   * executor.executeWithArgs('grep', [userInput, 'file.txt'])
   * ```
   */
  readonly executeWithArgs: (
    command: string,
    args: ReadonlyArray<string>
  ) => Effect.Effect<CommandResult, CommandExecutionError, never>
}

export const ExecutorService = Context.GenericTag<ExecutorService>('ExecutorService')

/**
 * Live implementation of ExecutorService
 */
export const ExecutorServiceLive = Layer.effect(
  ExecutorService,
  Effect.gen(function* () {
    const executeWithArgs = (
      command: string,
      args: ReadonlyArray<string>
    ): Effect.Effect<CommandResult, CommandExecutionError> =>
      Effect.acquireUseRelease(
        // Acquire: spawn the process
        Effect.sync(() =>
          Bun.spawn([command, ...args], {
            stdout: 'pipe',
            stderr: 'pipe',
          })
        ),
        // Use: wait for process to complete and collect output
        (proc) =>
          Effect.tryPromise({
            try: async () => {
              const exitCode = await proc.exited
              const stdout = await new Response(proc.stdout).text()
              const stderr = await new Response(proc.stderr).text()

              if (exitCode !== 0) {
                throw new CommandExecutionError(
                  `${command} ${args.join(' ')}`,
                  exitCode,
                  stderr
                )
              }

              return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
              }
            },
            catch: (error) =>
              error instanceof CommandExecutionError
                ? error
                : new CommandExecutionError(
                    `${command} ${args.join(' ')}`,
                    -1,
                    String(error)
                  ),
          }),
        // Release: cleanup - kill process if still running
        (proc) =>
          Effect.sync(() => {
            try {
              // Only kill if process is still running
              if (!proc.killed) {
                proc.kill()
              }
            } catch {
              // Process already exited, ignore error
            }
          })
      ).pipe(
        Effect.timeout(Duration.minutes(DEFAULT_COMMAND_TIMEOUT_MINUTES)),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new CommandExecutionError(
              `${command} ${args.join(' ')}`,
              -1,
              `Command timed out after ${DEFAULT_COMMAND_TIMEOUT_MINUTES} minutes`
            )
          )
        )
      )

    const execute = (command: string): Effect.Effect<CommandResult, CommandExecutionError> =>
      Effect.acquireUseRelease(
        // Acquire: spawn the shell process
        Effect.sync(() =>
          Bun.spawn(['sh', '-c', command], {
            stdout: 'pipe',
            stderr: 'pipe',
          })
        ),
        // Use: wait for process to complete and collect output
        (proc) =>
          Effect.tryPromise({
            try: async () => {
              const exitCode = await proc.exited
              const stdout = await new Response(proc.stdout).text()
              const stderr = await new Response(proc.stderr).text()

              if (exitCode !== 0) {
                throw new CommandExecutionError(command, exitCode, stderr)
              }

              return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
              }
            },
            catch: (error) =>
              error instanceof CommandExecutionError
                ? error
                : new CommandExecutionError(command, -1, String(error)),
          }),
        // Release: cleanup - kill process if still running
        (proc) =>
          Effect.sync(() => {
            try {
              // Only kill if process is still running
              if (!proc.killed) {
                proc.kill()
              }
            } catch {
              // Process already exited, ignore error
            }
          })
      ).pipe(
        Effect.timeout(Duration.minutes(DEFAULT_COMMAND_TIMEOUT_MINUTES)),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new CommandExecutionError(
              command,
              -1,
              `Command timed out after ${DEFAULT_COMMAND_TIMEOUT_MINUTES} minutes`
            )
          )
        )
      )

    return ExecutorService.of({
      execute,
      executeWithArgs,
    })
  })
)
