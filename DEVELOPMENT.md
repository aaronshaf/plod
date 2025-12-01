# Development Guide

## Architecture Overview

`plod` is built with:
- **Bun** - Runtime and package manager
- **Effect.js** - Functional effects for composable, type-safe operations
- **Effect Schema** - Runtime type validation for configuration
- **Claude Agent SDK** - AI-powered build failure remediation
- **Commander** - CLI framework

## Project Structure

```
plod/
├── src/
│   ├── cli/
│   │   └── index.ts          # CLI entry point with commander
│   ├── services/
│   │   ├── config.ts         # Configuration loading service
│   │   ├── executor.ts       # Shell command execution service
│   │   ├── claude-worker.ts  # Claude Agent SDK wrapper service
│   │   └── poller.ts         # Main polling orchestration service
│   ├── schemas/
│   │   └── config.ts         # Effect Schema for plod.config.json
│   └── utils/
├── bin/
│   └── plod                  # Bun shebang entry
├── index.ts                  # Public API exports
└── plod.config.json          # Configuration file
```

## Core Services

### ConfigService
Loads and validates `plod.config.json` using Effect Schema.

### ExecutorService
Executes shell commands using `Bun.spawn`. Provides both single-string command execution and command-with-args execution.

### ClaudeWorkerService
Wraps the Claude Agent SDK's `query()` function to fix build failures. Uses inherited authentication from the environment.

### PollerService
Orchestrates the main workflow:
1. Poll build status
2. If pending → wait and retry
3. If success → exit
4. If failure → extract details → run Claude → publish → retry

## Configuration Schema

```typescript
{
  commands: {
    publish: string              // Command to publish changes
    checkBuildStatus: string     // Command to check build status
    checkBuildFailures: string   // Command to extract failure details
  },
  work: {
    command: string              // Claude command (usually "claude")
    args: string[]               // Arguments to pass
  },
  polling: {
    intervalSeconds: number      // Polling interval
    maxIterations: number        // Max retry attempts
  }
}
```

## Development Commands

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Build (just type checks, runs via bun directly)
bun run build

# Run CLI
bun run dev [command]

# Format code
bun run format
bun run format:check

# Test
bun test
```

## Adding New Features

### Adding a New Service

1. Create service file in `src/services/`
2. Define service interface with Context.GenericTag
3. Implement service with Layer.effect
4. Export service, implementation, and types
5. Add to `index.ts` exports

Example:
```typescript
import { Context, Effect, Layer } from 'effect'

export interface MyService {
  readonly myMethod: () => Effect.Effect<string, MyError, never>
}

export const MyService = Context.GenericTag<MyService>('MyService')

export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const myMethod = () => Effect.succeed('hello')
    return MyService.of({ myMethod })
  })
)
```

### Adding a New CLI Command

1. Add command in `src/cli/index.ts` using commander
2. Build Effect program with proper layer dependencies
3. Use `Effect.provide()` to inject required services
4. Handle errors appropriately

## Testing Strategy

(To be implemented)

- Unit tests for services
- Integration tests for full workflow
- Mock external dependencies (Claude SDK, shell commands)
- Use Effect's testing utilities

## Effect.js Patterns Used

- **Services**: Context.GenericTag for dependency injection
- **Layers**: Layer.effect for service implementations
- **Error Handling**: Tagged unions for typed errors
- **Effect.gen**: Generator-based composition
- **Effect.async**: Wrapping callback-based APIs

## Debugging

Set environment variable for debug output:
```bash
DEBUG=1 plod start
```

## Security Considerations

### Command Injection Risks

⚠️ **IMPORTANT**: All commands in `plod.config.json` are executed via shell (`sh -c`), which provides powerful features (pipes, redirects, etc.) but also introduces security risks.

**Safe Usage:**
```json
{
  "commands": {
    "checkBuildStatus": "ger build-status",
    "publish": "git push origin HEAD:refs/for/master"
  }
}
```

**Unsafe Usage (Never do this):**
```typescript
// ❌ DANGER: Command injection vulnerability
const userInput = getUserInput()
executor.execute(`grep ${userInput} file.txt`)

// ✅ SAFE: Use executeWithArgs instead
executor.executeWithArgs('grep', [userInput, 'file.txt'])
```

**Guidelines:**
- Only use commands from trusted sources (config files, hardcoded values)
- Never interpolate user input into command strings
- Validate all config files before use
- Review `plod.config.json` for suspicious patterns
- Consider using `executeWithArgs` when possible for better isolation

### Config File Security

Your `plod.config.json` file:
- Should be version controlled (not gitignored by default)
- Should NOT contain secrets, API keys, or passwords
- Should be reviewed during code review
- Commands should be treated as executable code

## Common Issues

### Authentication
The Claude Agent SDK requires authentication. Ensure you're logged in to Claude Code:
```bash
claude auth
```

### Build Status Commands
Ensure your `checkBuildStatus` command outputs text containing:
- "success" for successful builds
- "failure" or "failed" for failed builds
- "pending" for in-progress builds

### Command Execution
All commands in `plod.config.json` are executed via `sh -c`, so you can use pipes, redirects, and other shell features. This is powerful but requires trusted input only.
