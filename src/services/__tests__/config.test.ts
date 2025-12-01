import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Effect, Layer, Cause } from 'effect'
import { ConfigService, ConfigServiceLive, type ConfigError } from '../config.ts'
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Helper to extract the actual error from Effect FiberFailure
const extractError = <E>(cause: Cause.Cause<E>): E | null => {
  return Cause.failureOption(cause).pipe(
    (opt) => (opt._tag === 'Some' ? opt.value : null)
  )
}

const TEST_DIR = '/tmp/plod-test-config'
const TEST_CONFIG_PATH = join(TEST_DIR, 'test-config.json')

describe('ConfigService', () => {
  beforeEach(() => {
    // Create test directory
    try {
      mkdirSync(TEST_DIR, { recursive: true })
    } catch {
      // Directory may already exist
    }
  })

  afterEach(() => {
    // Clean up test files
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  test('should load valid config successfully', async () => {
    const validConfig = {
      commands: {
        publish: 'git push',
        checkBuildStatus: 'echo success',
        checkBuildFailures: 'echo failures',
      },
      work: {
        command: 'claude',
        args: ['-p', 'fix issues'],
      },
      polling: {
        intervalSeconds: 30,
        maxIterations: 10,
      },
    }

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig, null, 2))

    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      const config = yield* service.loadFrom(TEST_CONFIG_PATH)

      expect(config.commands.publish).toBe('git push')
      expect(config.polling.intervalSeconds).toBe(30)
      expect(config.work.args).toEqual(['-p', 'fix issues'])
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    await Effect.runPromise(runnable)
  })

  test('should fail with ConfigNotFoundError for missing file', async () => {
    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      return yield* service.loadFrom('/nonexistent/config.json')
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    const result = await Effect.runPromiseExit(runnable)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as ConfigError
      expect(error._tag).toBe('ConfigNotFoundError')
      if (error._tag === 'ConfigNotFoundError') {
        expect(error.path).toBe('/nonexistent/config.json')
      }
    }
  })

  test('should fail with ConfigParseError for invalid JSON', async () => {
    writeFileSync(TEST_CONFIG_PATH, '{ invalid json }')

    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      return yield* service.loadFrom(TEST_CONFIG_PATH)
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    const result = await Effect.runPromiseExit(runnable)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as ConfigError
      expect(error._tag).toBe('ConfigParseError')
    }
  })

  test('should fail with ConfigValidationError for invalid schema', async () => {
    const invalidConfig = {
      commands: {
        // Missing required fields
        publish: 'git push',
      },
      // Missing work and polling sections
    }

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig))

    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      return yield* service.loadFrom(TEST_CONFIG_PATH)
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    const result = await Effect.runPromiseExit(runnable)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as ConfigError
      expect(error._tag).toBe('ConfigValidationError')
    }
  })

  test('should validate polling config types', async () => {
    const configWithWrongTypes = {
      commands: {
        publish: 'git push',
        checkBuildStatus: 'echo success',
        checkBuildFailures: 'echo failures',
      },
      work: {
        command: 'claude',
        args: ['-p', 'fix issues'],
      },
      polling: {
        intervalSeconds: 'thirty', // Should be number
        maxIterations: 10,
      },
    }

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithWrongTypes))

    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      return yield* service.loadFrom(TEST_CONFIG_PATH)
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    const result = await Effect.runPromiseExit(runnable)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as ConfigError
      expect(error._tag).toBe('ConfigValidationError')
    }
  })

  test('should handle negative numbers in polling config', async () => {
    const configWithNegative = {
      commands: {
        publish: 'git push',
        checkBuildStatus: 'echo success',
        checkBuildFailures: 'echo failures',
      },
      work: {
        command: 'claude',
        args: ['-p', 'fix issues'],
      },
      polling: {
        intervalSeconds: -30, // Negative not allowed
        maxIterations: 10,
      },
    }

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(configWithNegative))

    const program = Effect.gen(function* () {
      const service = yield* ConfigService
      return yield* service.loadFrom(TEST_CONFIG_PATH)
    })

    const runnable = Effect.provide(program, ConfigServiceLive)
    const result = await Effect.runPromiseExit(runnable)

    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      const error = extractError(result.cause) as ConfigError
      expect(error._tag).toBe('ConfigValidationError')
    }
  })
})
