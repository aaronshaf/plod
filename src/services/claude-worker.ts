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
          fullPrompt = `Build failures detected:\n\n${failureDetails}\n\n${fullPrompt}\n\nCRITICAL INSTRUCTIONS:
1. You MUST actually FIX the code - do not just analyze or explain the problem
2. Use the Edit tool to modify the failing files immediately
3. Make the specific code changes needed to fix the test failures
4. Do NOT stop after reading files - you must write/edit files to fix the issues
5. If you understand the problem, fix it right away - do not ask for permission

Start by reading the necessary files, then IMMEDIATELY use Edit to fix them.`

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
              maxTurns: 25, // Increased from 10 to allow more back-and-forth for complex fixes
              model: 'sonnet',
              permissionMode: 'bypassPermissions',
              allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task'],
              settingSources: ['project'],
              sandbox: {
                enabled: true,
                allowedPaths: [process.cwd()], // Allow full access to the working directory
              },
            },
          })

          for await (const message of sdkQuery) {
            const msg = message as any

            // Capture assistant messages (Claude's responses)
            if (message.type === 'assistant' && msg.message) {
              // Extract text from message.content array
              if (Array.isArray(msg.message.content)) {
                for (const block of msg.message.content) {
                  if (block.type === 'text' && block.text) {
                    output.push(block.text)
                    process.stdout.write(block.text + '\n')
                  }
                }
              }
            }

            // Capture tool progress (file edits, reads, etc.)
            if (message.type === 'tool_progress') {
              console.log(
                JSON.stringify({
                  event: 'claude_tool_progress',
                  tool: (message as any).tool,
                  status: (message as any).status,
                })
              )
            }

            // Capture result messages
            if (message.type === 'result') {
              const resultMsg = message as any
              console.log(
                JSON.stringify({
                  event: 'claude_result',
                  success: resultMsg.success,
                  numTurns: resultMsg.num_turns,
                  isError: resultMsg.is_error,
                  errors: resultMsg.errors,
                  message: resultMsg.message || resultMsg.text,
                })
              )
              if (resultMsg.text) {
                output.push(resultMsg.text)
              }
            }

            // Capture system messages
            if (message.type === 'system') {
              const systemMsg = message as any
              console.log(
                JSON.stringify({
                  event: 'claude_system',
                  message: systemMsg.text || systemMsg.message,
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
