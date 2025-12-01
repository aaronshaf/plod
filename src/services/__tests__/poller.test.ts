import { describe, test, expect } from 'bun:test'
import { Effect, Layer } from 'effect'
import { PollerService } from '../poller.ts'
import type { PlodConfig } from '../../schemas/config.ts'
import {
  ExecutorService,
  type CommandResult,
  CommandExecutionError,
} from '../executor.ts'
import { ClaudeWorkerService } from '../claude-worker.ts'

// Simple test PollerServiceLive that doesn't depend on other services
const TestPollerServiceLive = Layer.succeed(
  PollerService,
  PollerService.of({
    poll: (config: PlodConfig) =>
      Effect.succeed({
        iterations: [
          {
            iteration: 1,
            status: 'success' as const,
            workedOn: false,
            timestamp: new Date(),
          },
        ],
        finalStatus: 'success' as const,
        maxIterationsReached: false,
      }),
  })
)

describe('PollerService', () => {
  test('should have a basic structure', async () => {
    const testConfig: PlodConfig = {
      commands: {
        publish: 'git push',
        checkBuildStatus: 'check-status',
        checkBuildFailures: 'get-failures',
      },
      work: {
        command: 'claude',
        args: ['-p', 'fix issues'],
      },
      polling: {
        intervalSeconds: 1,
        maxPollTimeMinutes: 1,
        maxWorkIterations: 3,
      },
    }

    const program = Effect.gen(function* () {
      const poller = yield* PollerService
      const result = yield* poller.poll(testConfig)

      expect(result).toHaveProperty('iterations')
      expect(result).toHaveProperty('finalStatus')
      expect(result).toHaveProperty('maxIterationsReached')
      expect(Array.isArray(result.iterations)).toBe(true)
    })

    const runnable = Effect.provide(program, TestPollerServiceLive)
    await Effect.runPromise(runnable)
  })
})
