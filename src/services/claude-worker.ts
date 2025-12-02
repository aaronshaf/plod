/**
 * Service for executing Claude Code Agent SDK to fix build failures
 */
import { Context, Effect, Layer, Duration } from 'effect'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { WorkConfig } from '../schemas/config.ts'

/**
 * Result of running Claude to fix issues
 */
export interface ClaudeWorkResult {
  readonly success: boolean
  readonly output: string
}

/**
 * Error running Claude worker
 */
export class ClaudeWorkerError {
  readonly _tag = 'ClaudeWorkerError'
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

/**
 * Claude worker service interface
 */
export interface ClaudeWorkerService {
  /**
   * Run Claude Code Agent to fix build failures
   * @param workConfig - Work command configuration
   * @param failureDetails - Build failure details to pipe into the work command
   * @param timeoutMinutes - Optional timeout in minutes (default: 10)
   */
  readonly work: (
    workConfig: WorkConfig,
    failureDetails: string,
    timeoutMinutes?: number
  ) => Effect.Effect<ClaudeWorkResult, ClaudeWorkerError, never>
}

export const ClaudeWorkerService = Context.GenericTag<ClaudeWorkerService>(
  'ClaudeWorkerService'
)

/**
 * Live implementation of ClaudeWorkerService
 */
export const ClaudeWorkerServiceLive = Layer.effect(
  ClaudeWorkerService,
  Effect.gen(function* () {
    const work = (
      workConfig: WorkConfig,
      failureDetails: string,
      timeoutMinutes: number = 10
    ): Effect.Effect<ClaudeWorkResult, ClaudeWorkerError> =>
      Effect.tryPromise({
        try: async () => {
          // Validate work config
          const promptArgIndex = workConfig.args.indexOf('-p')
          if (promptArgIndex === -1 || promptArgIndex >= workConfig.args.length - 1) {
            throw new Error('Invalid work config: -p flag requires a prompt argument')
          }

          // Construct the full prompt with failure details
          let fullPrompt = workConfig.args[promptArgIndex + 1]
          fullPrompt = `Build failures detected:\n\n${failureDetails}\n\n${fullPrompt}`

          // Log the prompt being sent
          console.log(
            JSON.stringify({
              event: 'claude_prompt',
              promptLength: fullPrompt.length,
              promptPreview: fullPrompt.substring(0, 500),
            })
          )

          // Run the Claude Agent SDK
          // The SDK will inherit authentication automatically from the environment
          const output: string[] = []

          const sdkQuery = query({
            prompt: fullPrompt,
            options: {
              cwd: process.cwd(),
              maxTurns: 10,
              model: 'sonnet',
              permissionMode: 'acceptEdits',
              allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task'],
              settingSources: ['project'],
            },
          })

          for await (const message of sdkQuery) {
            // Log all message types for debugging
            console.log(JSON.stringify({ event: 'claude_message', messageType: message.type }))

            // Stream output in real-time
            if ('text' in message && typeof message.text === 'string') {
              output.push(message.text)
              // Output Claude's response as it comes
              process.stdout.write(message.text)
            }

            // Capture result and system messages
            if (message.type === 'result' || message.type === 'system') {
              console.log(
                JSON.stringify({
                  event: 'claude_special_message',
                  type: message.type,
                  content: JSON.stringify(message),
                })
              )
            }
          }

          // Log final statistics
          console.log(
            JSON.stringify({
              event: 'claude_complete',
              totalOutputLength: output.length,
              hasOutput: output.length > 0,
            })
          )

          return {
            success: true,
            output: output.join(''),
          }
        },
        catch: (error) => new ClaudeWorkerError('Failed to run Claude agent', error),
      }).pipe(
        Effect.timeout(Duration.minutes(timeoutMinutes)),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new ClaudeWorkerError(`Claude agent timed out after ${timeoutMinutes} minutes`)
          )
        )
      )

    return ClaudeWorkerService.of({
      work,
    })
  })
)
