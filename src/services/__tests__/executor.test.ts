import { describe, test, expect } from 'bun:test'
import { Effect, Cause } from 'effect'
import { ExecutorService, ExecutorServiceLive, CommandExecutionError } from '../executor.ts'

// Helper to extract the actual error from Effect FiberFailure
const extractError = <E>(cause: Cause.Cause<E>): E | null => {
  return Cause.failureOption(cause).pipe(
    (opt) => (opt._tag === 'Some' ? opt.value : null)
  )
}

describe('ExecutorService', () => {
  test('should execute simple command successfully', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.execute('echo "hello world"')

      expect(result.stdout).toBe('hello world')
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should execute command with pipes', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.execute('echo "line1\nline2\nline3" | grep line2')

      expect(result.stdout).toBe('line2')
      expect(result.exitCode).toBe(0)
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should fail with CommandExecutionError for non-zero exit code', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      return yield* executor.execute('exit 1')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)

    const result = await Effect.runPromiseExit(runnable)
    expect(result._tag).toBe('Failure')

    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as CommandExecutionError
      expect(error._tag).toBe('CommandExecutionError')
      expect(error.exitCode).toBe(1)
    }
  })

  test('should fail with CommandExecutionError for nonexistent command', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      return yield* executor.execute('nonexistent-command-xyz')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)

    const result = await Effect.runPromiseExit(runnable)
    expect(result._tag).toBe('Failure')

    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as CommandExecutionError
      expect(error._tag).toBe('CommandExecutionError')
    }
  })

  test('should execute command with args successfully', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.executeWithArgs('echo', ['hello', 'world'])

      expect(result.stdout).toBe('hello world')
      expect(result.exitCode).toBe(0)
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should handle stderr output', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      // Use a command that writes to stderr but succeeds
      const result = yield* executor.execute('echo "error message" >&2 && exit 0')

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('error message')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should capture both stdout and stderr on failure', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      return yield* executor.execute('echo "output" && printf "error" >&2 && exit 1')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)

    const result = await Effect.runPromiseExit(runnable)
    expect(result._tag).toBe('Failure')

    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as CommandExecutionError
      expect(error._tag).toBe('CommandExecutionError')
      expect(error.exitCode).toBe(1)
      expect(error.stderr).toBe('error')
    }
  })

  test('should trim whitespace from output', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.execute('echo "  hello  "')

      expect(result.stdout).toBe('hello')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should handle empty output', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.execute('true') // Command that produces no output

      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should execute commands with special characters', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      const result = yield* executor.execute('echo "test$USER"')

      // $USER should be expanded by the shell
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test')
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })

  test('executeWithArgs should prevent shell expansion', async () => {
    const program = Effect.gen(function* () {
      const executor = yield* ExecutorService
      // Using executeWithArgs should treat $USER as literal string
      const result = yield* executor.executeWithArgs('echo', ['$USER'])

      expect(result.stdout).toBe('$USER')
      expect(result.exitCode).toBe(0)
    })

    const runnable = Effect.provide(program, ExecutorServiceLive)
    await Effect.runPromise(runnable)
  })
})
