# plod

**CI build failure feedback loop automation with Claude Code Agent SDK**

`plod` automates the tedious cycle of:
1. Waiting for your CI build to complete
2. Checking if it failed
3. Extracting failure details
4. Fixing the issues with Claude Code
5. Publishing the fixes
6. Repeating until the build passes

Think of it like `gh run watch` but for Gerrit CI, with automatic failure remediation powered by Claude Code Agent SDK.

## Features

- 🔄 **Automated polling** - Continuously monitors build status
- 🤖 **AI-powered fixes** - Uses Claude Code Agent SDK to resolve build failures
- ⚙️ **Configurable workflow** - Define your own commands for publish, status check, and failure extraction
- 🎯 **Smart iteration limits** - Prevents infinite loops with configurable max iterations
- 📊 **Detailed reporting** - Shows iteration history and final status
- 🛠️ **Built with Effect.js** - Type-safe, composable effects throughout

## Installation

```bash
# Install globally
bun install -g @aaronshaf/plod

# Or use in your project
bun add @aaronshaf/plod
```

## Quick Start

### Step 1: Ensure Prerequisites

Make sure you have:
- **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)
- **Claude Code** authenticated (the Agent SDK will use your credentials)
- Your CI/build tools installed (e.g., `ger`, `jk` for the example below)

### Step 2: Create Configuration File

Create a `plod.config.json` in your project root:

```json
{
  "commands": {
    "publish": "git push origin HEAD:refs/for/master",
    "checkBuildStatus": "ger build-status",
    "checkBuildFailures": "ger extract-url \"build-summary-report\" | tail -1 | jk failures --smart --xml"
  },
  "work": {
    "command": "claude",
    "args": [
      "-p",
      "resolve these issues; stay on current commit; amend to commit as issues are resolved"
    ]
  },
  "polling": {
    "intervalSeconds": 30,
    "maxIterations": 10
  }
}
```

**Note**: Copy the example config to get started:
```bash
cp plod.config.json.example plod.config.json
# Then edit plod.config.json to match your CI system
```

### Step 3: Validate Your Configuration

Test that your config is valid:

```bash
plod validate
```

This will:
- Check that the JSON is valid
- Verify all required fields are present
- Display your parsed configuration

### Step 4: Start Monitoring

```bash
# Start monitoring (default action)
plod

# Or explicitly use the start command
plod start

# Use a custom config file
plod --config ./my-config.json
```

## Configuration Reference

The `plod.config.json` file controls all aspects of plod's behavior.

### `commands` (Required)

Shell commands that plod executes during the workflow. All commands are executed via `sh -c`, so you can use pipes, redirects, and other shell features.

#### `publish` (string, required)
Command to publish your changes after Claude fixes issues.

**Example**:
```json
"publish": "git push origin HEAD:refs/for/master"
```

**Notes**:
- This command runs after Claude makes fixes
- Should push to your code review system (Gerrit, GitHub, etc.)
- Runs every time after a fix is applied

#### `checkBuildStatus` (string, required)
Command that checks the current build status.

**Requirements**:
- Must output text containing one of these words (case-insensitive):
  - **Success**: `success`, `successful`, `passed`, `pass`, `ok`
  - **Failure**: `fail`, `failure`, `failed`, `error`, `broken`
  - **Pending**: `pending`, `running`, `in-progress`, `building`, `queued`

**Example**:
```json
"checkBuildStatus": "ger build-status"
```

**Tip**: Test your command manually first:
```bash
ger build-status  # Should output something like "Status: success"
```

#### `checkBuildFailures` (string, required)
Command to extract detailed failure information when a build fails.

**Requirements**:
- Should output failure details (stack traces, error messages, etc.)
- This output is sent to Claude Code Agent to fix the issues
- Can be XML, JSON, plain text - whatever Claude can understand

**Example**:
```json
"checkBuildFailures": "ger extract-url \"build-summary-report\" | tail -1 | jk failures --smart --xml"
```

**Tips**:
- More detailed output = better fixes from Claude
- Include file paths, line numbers, error messages
- Use `--xml` or `--json` flags if your tools support it

### `work` (Required)

Configuration for the Claude Code Agent SDK that fixes issues.

#### `command` (string, required)
The command to execute - typically `"claude"` for Claude Code.

#### `args` (array of strings, required)
Arguments to pass to the work command.

**Example**:
```json
"work": {
  "command": "claude",
  "args": [
    "-p",
    "resolve these issues; stay on current commit; amend to commit as issues are resolved"
  ]
}
```

**Common patterns**:
- Always include `"-p"` followed by your prompt
- Use `"stay on current commit"` to avoid creating new commits
- Use `"amend to commit"` to update the existing commit with fixes

### `polling` (Required)

Controls how plod monitors your build.

#### `intervalSeconds` (number, required)
Seconds to wait between status checks.

**Guidelines**:
- `10-30`: For fast CI systems (< 5 min builds)
- `30-60`: For medium CI systems (5-15 min builds)
- `60-120`: For slow CI systems (> 15 min builds)

**Example**: `30` (check every 30 seconds)

#### `maxIterations` (number, required)
Maximum number of fix-and-republish cycles before giving up.

**Guidelines**:
- `3-5`: For simple fixes (most issues resolved in 1-2 iterations)
- `5-10`: For complex issues (might need multiple attempts)
- `10+`: For very complex issues (use with caution - may waste time)

**Example**: `10` (try up to 10 times)

---

## Configuration Examples

### For GitHub Actions

```json
{
  "commands": {
    "publish": "git push",
    "checkBuildStatus": "gh run view --json status --jq .status",
    "checkBuildFailures": "gh run view --log-failed"
  },
  "work": {
    "command": "claude",
    "args": ["-p", "fix the failing tests"]
  },
  "polling": {
    "intervalSeconds": 20,
    "maxIterations": 5
  }
}
```

### For Jenkins

```json
{
  "commands": {
    "publish": "git push origin HEAD",
    "checkBuildStatus": "jk status",
    "checkBuildFailures": "jk failures --xml"
  },
  "work": {
    "command": "claude",
    "args": ["-p", "resolve build failures"]
  },
  "polling": {
    "intervalSeconds": 60,
    "maxIterations": 8
  }
}
```

### For GitLab CI

```json
{
  "commands": {
    "publish": "git push",
    "checkBuildStatus": "glab ci status",
    "checkBuildFailures": "glab ci trace"
  },
  "work": {
    "command": "claude",
    "args": ["-p", "fix CI failures"]
  },
  "polling": {
    "intervalSeconds": 30,
    "maxIterations": 7
  }
}
```

## CLI Commands

### `plod` / `plod start`

Start monitoring build status and automatically fix failures. The `start` command is the default action, so you can just run `plod`.

```bash
# Default action
plod

# Explicit start command
plod start

# With custom config
plod --config ./custom-config.json
plod start --config ./custom-config.json
```

### `plod validate`

Validate your `plod.config.json` without running.

```bash
plod validate
plod validate --config ./custom-config.json
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  1. Poll: Check build status                           │
│     ↓                                                   │
│  2. Is build pending?                                   │
│     Yes → Wait and poll again                           │
│     No  → Continue                                      │
│     ↓                                                   │
│  3. Did build succeed?                                  │
│     Yes → Exit successfully ✓                           │
│     No  → Continue                                      │
│     ↓                                                   │
│  4. Extract failure details                             │
│     ↓                                                   │
│  5. Run Claude Code Agent to fix issues                 │
│     ↓                                                   │
│  6. Publish fixes                                       │
│     ↓                                                   │
│  7. Reached max iterations?                             │
│     Yes → Exit with failure ✗                           │
│     No  → Go back to step 1                             │
└─────────────────────────────────────────────────────────┘
```

## Programmatic Usage

You can also use plod as a library:

```typescript
import { Effect, Layer } from 'effect'
import {
  ConfigServiceLive,
  ExecutorServiceLive,
  ClaudeWorkerServiceLive,
  PollerServiceLive,
  PollerService,
  loadConfig,
} from '@aaronshaf/plod'

const main = Effect.gen(function* () {
  const config = yield* loadConfig()
  const poller = yield* PollerService
  const result = yield* poller.poll(config)

  console.log('Iterations:', result.iterations.length)
  console.log('Final status:', result.finalStatus)
  console.log('Max iterations reached:', result.maxIterationsReached)
})

const AppLive = Layer.mergeAll(
  ConfigServiceLive,
  ExecutorServiceLive,
  ClaudeWorkerServiceLive,
  PollerServiceLive
)

const runnable = Effect.provide(main, AppLive)
await Effect.runPromise(runnable)
```

## Troubleshooting

### Configuration Issues

**Error: "Configuration file not found"**
```bash
# Make sure plod.config.json is in your current directory
ls plod.config.json

# Or specify the path explicitly
plod --config /path/to/plod.config.json
```

**Error: "Failed to parse configuration"**
```bash
# Validate your JSON syntax
cat plod.config.json | jq .

# Common issues:
# - Missing commas between fields
# - Trailing commas (not allowed in JSON)
# - Unescaped quotes in strings (use \" inside strings)
```

**Error: "Configuration validation failed"**
```bash
# Use plod validate to see detailed errors
plod validate

# Check that all required fields are present:
# - commands.publish
# - commands.checkBuildStatus
# - commands.checkBuildFailures
# - work.command
# - work.args
# - polling.intervalSeconds (must be positive number)
# - polling.maxIterations (must be positive number)
```

**Build status not detected correctly**
```bash
# Test your checkBuildStatus command manually
ger build-status

# Make sure the output contains one of these keywords:
# Success: success, successful, passed, pass, ok
# Failure: fail, failure, failed, error, broken
# Pending: pending, running, in-progress, building, queued
```

**Claude not making fixes**
```bash
# Check that Claude Code is authenticated
claude auth status

# Make sure your work command is correct
# The -p flag must be followed by your prompt
"args": ["-p", "your prompt here"]
```

### Command Timeouts

All commands have built-in timeouts to prevent hanging:
- **Command execution**: 5 minutes (publish, checkBuildStatus, checkBuildFailures)
- **Claude Agent**: 10 minutes (work command)

If you hit timeouts regularly, your commands may be too slow or stuck.

## Authentication

The Claude Code Agent SDK automatically inherits authentication from your environment. No need to configure API keys explicitly - just ensure you're authenticated with Claude Code before running plod.

```bash
# Check authentication status
claude auth status

# Authenticate if needed
claude auth login
```

## Requirements

- **Bun** >= 1.2.0
- **Claude Code** - For Agent SDK authentication
- Custom tools referenced in your config (e.g., `ger`, `jk`)

## Related Projects

- [@aaronshaf/ger](https://github.com/aaronshaf/ger) - Gerrit CLI and SDK
- [@aaronshaf/jk](https://github.com/aaronshaf/jk) - Jenkins CLI for inspecting builds
- [@aaronshaf/ji](https://github.com/aaronshaf/ji) - Jira CLI with LLM-friendly output

## License

MIT
