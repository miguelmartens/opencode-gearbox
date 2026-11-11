Configuration in this service is a mess: `PORT` and `DEBUG` are read from `process.env` in several places with different defaults and different parsing, and bad values are silently ignored. Use a subagent to find every place that reads `process.env` or these settings first, then fix it.

What I want:

- `loadConfig(env: Record<string, string | undefined>): Config` in `src/config.ts` is the only parser of these settings. `Config` stays `{ port: number; debug: boolean }`.
- `PORT`: unset or empty means `3000`. Otherwise it must be digits only and an integer from 1 to 65535.
- `DEBUG`: `'1'`, `'true'`, `'yes'` (case-insensitive) mean `true`; `'0'`, `'false'`, `'no'`, `''` or unset mean `false`. Anything else is an error.
- Invalid values throw a `ConfigError` (export it from `src/config.ts`, a subclass of `Error`) whose message names the bad variable, e.g. `PORT`.
- Nothing except `src/main.ts` reads `process.env`. Change `createLogger(name, config, write?)` in `src/logger.ts` and `describeServer(config)` in `src/server.ts` to take the `Config` from `loadConfig` instead, and have `start(env, write)` in `src/main.ts` pass it through.

Update the tests to match and cover the validation.
