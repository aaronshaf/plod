/**
 * Configuration service for loading and validating plod.config.json
 */
import { Context, Effect, Layer } from 'effect'
import { FileSystem } from '@effect/platform'
import { NodeFileSystem } from '@effect/platform-node'
import * as ConfigSchema from '../schemas/config.ts'

/**
 * Errors that can occur during config loading
 */
export class ConfigNotFoundError {
  readonly _tag = 'ConfigNotFoundError'
  constructor(readonly path: string) {}
}

export class ConfigParseError {
  readonly _tag = 'ConfigParseError'
  constructor(
    readonly path: string,
    readonly cause: unknown
  ) {}
}

export class ConfigValidationError {
  readonly _tag = 'ConfigValidationError'
  constructor(
    readonly path: string,
    readonly errors: unknown
  ) {}
}

export class ConfigAccessError {
  readonly _tag = 'ConfigAccessError'
  constructor(
    readonly path: string,
    readonly cause: unknown
  ) {}
}

export type ConfigError =
  | ConfigNotFoundError
  | ConfigParseError
  | ConfigValidationError
  | ConfigAccessError

/**
 * Configuration service interface
 */
export interface ConfigService {
  /**
   * Load and validate plod.config.json from the current working directory
   */
  readonly load: Effect.Effect<ConfigSchema.PlodConfig, ConfigError, never>

  /**
   * Load config from a specific path
   */
  readonly loadFrom: (
    path: string
  ) => Effect.Effect<ConfigSchema.PlodConfig, ConfigError, never>
}

export const ConfigService = Context.GenericTag<ConfigService>('ConfigService')

/**
 * Live implementation of ConfigService
 */
export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const loadFrom = (path: string): Effect.Effect<ConfigSchema.PlodConfig, ConfigError> =>
      Effect.gen(function* () {
        // Check if file exists
        const exists = yield* fs.exists(path).pipe(
          Effect.mapError(
            (error): ConfigError => new ConfigAccessError(path, error)
          )
        )
        if (!exists) {
          return yield* Effect.fail(new ConfigNotFoundError(path))
        }

        // Read file contents
        const contents = yield* fs.readFileString(path).pipe(
          Effect.mapError(
            (error): ConfigError => new ConfigParseError(path, error)
          )
        )

        // Parse JSON
        let parsed: unknown
        try {
          parsed = JSON.parse(contents)
        } catch (error) {
          return yield* Effect.fail(new ConfigParseError(path, error))
        }

        // Apply defaults to parsed config
        const parsedObj = parsed as any
        const configWithDefaults = {
          ...parsedObj,
          polling: {
            intervalSeconds: 10,
            maxPollTimeMinutes: 30,
            maxWorkIterations: 10,
            ...(parsedObj.polling || {}),
          },
        }

        // Validate against schema
        try {
          const config = ConfigSchema.decode(configWithDefaults)
          return config
        } catch (error) {
          return yield* Effect.fail(new ConfigValidationError(path, error))
        }
      })

    const load = (): Effect.Effect<ConfigSchema.PlodConfig, ConfigError> =>
      Effect.gen(function* () {
        const cwd = yield* Effect.sync(() => process.cwd())
        const configPath = `${cwd}/plod.config.json`
        return yield* loadFrom(configPath)
      })

    return ConfigService.of({
      load: load(),
      loadFrom,
    })
  })
).pipe(Layer.provide(NodeFileSystem.layer))

/**
 * Convenience function to load config from default location
 */
export const loadConfig = (): Effect.Effect<ConfigSchema.PlodConfig, ConfigError, ConfigService> =>
  Effect.gen(function* () {
    const service = yield* ConfigService
    return yield* service.load
  })

/**
 * Convenience function to load config from specific path
 */
export const loadConfigFrom = (
  path: string
): Effect.Effect<ConfigSchema.PlodConfig, ConfigError, ConfigService> =>
  Effect.gen(function* () {
    const service = yield* ConfigService
    return yield* service.loadFrom(path)
  })
