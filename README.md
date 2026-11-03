# Storeshot CLI

App Store and Google Play marketing screenshots from the command line, shell agents and CI. The
command is `storeshot`. It sends raw app screenshots to the
[Storeshot API](https://storeshot.art/docs/) and saves the finished images, fastlane folders
included.

> Published on npm with provenance from its public source repository, `Draggable/storeshot-cli`
> on GitHub. To run your own build of it instead, `npm ci && npm run build` there and run
> `node dist/bin.js <command>`.

## Install

```sh
npx @draggable/storeshot-cli <command>      # no install
npm install -g @draggable/storeshot-cli     # then: storeshot <command>
```

You need Node.js 18.3 or later.

Another publisher's npm package is called `storeshot`, and it also installs a `storeshot`
command. It is a different tool: this one is only `@draggable/storeshot-cli`, so always give npx
the scoped name. If a global install fails because a `storeshot` command already exists, uninstall
that package or use `npx @draggable/storeshot-cli`.

## Quick start (test mode, free)

Test mode is the default. Test keys never spend credits and return sample images of the exact
sizes.

```sh
storeshot login                       # opens nothing: prints a link and a code to approve
storeshot devices --store app_store   # the output sizes
storeshot set ./screens --store app_store,google_play --out . --layout fastlane
```

`./screens/captions.json` lists the screens, in listing order, with one caption each:

```json
{
  "app": { "name": "Trailmate", "description": "Offline hiking maps" },
  "screens": [
    { "file": "01-map.png", "caption": "Find every trail" },
    { "file": "02-offline.png", "caption": "Works offline" }
  ],
  "featureGraphic": { "screen": 1, "caption": "Trailmate" }
}
```

`file` is a plain file name inside the folder. `app` is optional when you pass `--app-name`, and
`featureGraphic` (Google Play only) is optional. `storeshot schema captions` prints the full
format.

## CI

Store an API key as a secret, then run the CLI with it. A live key spends credits only with
`--yes`, and `--max-credits` caps the spend:

```yaml
- name: Store screenshots
  env:
    STORESHOT_API_KEY: ${{ secrets.STORESHOT_API_KEY }}
  run: >
    npx @draggable/storeshot-cli set ./screens --store app_store,google_play
    --out . --layout fastlane --yes --max-credits 40
    --idempotency-key "$GITHUB_RUN_ID" --json > storeshot.json
```

```sh
storeshot set ./screens --store app_store --out . --layout fastlane --json > result.json
case $? in
  0) echo "all images saved" ;;
  9) echo "some images failed (refunded); the others are saved" ;;
  10) echo "still running: storeshot status <id> --wait" ;;
  11) echo "live spend needs --yes (or is over --max-credits)" ;;
  *) echo "failed: see result.json .error" ;;
esac
```

## Commands

Options for every command:

| Option             | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `--json`           | Write exactly one JSON document to stdout (see [JSON output](#json-output)).     |
| `--env test\|live` | Environment. Default `test`.                                                     |
| `--api-key <key>`  | API key. Prefer `STORESHOT_API_KEY`: argv is visible to other users and history. |
| `--quiet`          | No progress or notices on stderr (errors still print).                           |
| `--no-color`       | No colour on stderr (`NO_COLOR` and `TERM=dumb` work too).                       |
| `-h`, `--help`     | Help for the command.                                                            |

`storeshot --version` prints the version.

### storeshot login

Links this machine to your account with the device flow and stores a key. The CLI prints a link
and a code. Open the link, check the code and approve. It asks for a **test** key unless you pass
`--env live`.

| Flag                  | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `--no-wait`           | Print the code and exit. Run `storeshot login` again after approving. |
| `--timeout <seconds>` | Stop waiting earlier than the code's expiry (10 minutes).             |

`--no-wait` is for agents whose shell waits for a command to exit before they can show its output.

### storeshot logout

Forgets the stored key of the environment (`--all`: test and live) on this machine. The key still
exists: revoke it at https://console.storeshot.art/keys.

| Flag    | Meaning                           |
| ------- | --------------------------------- |
| `--all` | Forget the test and the live key. |

### storeshot whoami

The account and the key in use (environment, scopes, where the key came from). Never the key.

### storeshot credits

The credit balance (needs the `usage:read` scope, which `login` keys have).

### storeshot devices

The output sizes (device ids) of each store.

| Flag                   | Meaning                       |
| ---------------------- | ----------------------------- |
| `--store <store>`      | `app_store` or `google_play`. |
| `--include-deprecated` | Also list deprecated sizes.   |

### storeshot generate

One marketing image per screenshot (1–10 files), for one size:

```sh
storeshot generate home.png map.png --store app_store --device app_store_1290x2796 --app-name Trailmate --out shots
```

| Flag                                | Meaning                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `--store <store>`                   | Required.                                                                     |
| `--device <id>` / `--size <W>x<H>`  | Exactly one: a `storeshot devices` id of that store, or a catalogue size.     |
| `--app-name <name>`                 | Required.                                                                     |
| `--app-description <text>`          | Optional.                                                                     |
| `--caption <text>`                  | One caption for every image (default: derived from the screenshot).           |
| `--captions <file>`                 | A `captions.json`: a caption per file name.                                   |
| `--orientation portrait\|landscape` | Orientation.                                                                  |
| `--palette #RRGGBB:Name,…`          | 1–8 colours (default: extracted).                                             |
| `--logo <file>`                     | App icon or logo.                                                             |
| `--project <uuid>`                  | Put the images in a project.                                                  |
| `--idempotency-key <key>`           | A rerun with the same key returns the first jobs (`<key>-01`, `<key>-02`, …). |
| `--no-wait`                         | Return after creating the jobs.                                               |
| `--timeout <seconds>`               | Stop waiting after this long (default 600; the jobs continue).                |
| `--out <dir>`                       | Save the images as `NN_<input name>_<device>.png`.                            |
| `--force`                           | Replace existing files.                                                       |
| `--yes`                             | Confirm a live spend without a prompt.                                        |
| `--max-credits <n>`                 | Refuse to spend more than `n` live credits.                                   |

Every file is checked (PNG, JPEG or WebP, at most 20 MiB) before anything is uploaded.

### storeshot set

A whole store listing in one job: every screen on every device of one or both stores, one charge.

| Flag                                                | Meaning                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `--store app_store,google_play`                     | One or both stores (default: the stores of `--devices`).             |
| `--devices <id,…>`                                  | Device ids, at most 5 per store (default: what each store requires). |
| `--captions <file>`                                 | Default `<dir>/captions.json`.                                       |
| `--feature-graphic`                                 | Add the Google Play feature graphic (+1 image).                      |
| `--dry-run`                                         | Quote only: images and credits. Nothing is created or charged.       |
| `--layout store\|fastlane`                          | With `--out`: `store` (`<store>/<device>/NN.png`) or `fastlane`.     |
| `--app-name`, `--app-description`                   | Override the captions file's `app`.                                  |
| `--orientation`, `--palette`, `--logo`, `--project` | As for `generate`.                                                   |
| `--idempotency-key`, `--no-wait`, `--timeout`       | As for `generate`.                                                   |
| `--out`, `--force`, `--yes`, `--max-credits`        | As for `generate`.                                                   |

With `--layout fastlane`, `--out` is the **project root** (the folder that contains `fastlane/`):
the images go to `fastlane/screenshots/en-US/` and `fastlane/metadata/android/en-US/images/`. Then
run `fastlane deliver` / `fastlane supply` (supply replaces the screenshots of the folders it
uploads).

### storeshot status

```sh
storeshot status <id> [--wait] [--timeout <seconds>] [--kind set|generation]
```

The status of a set or generation. `--wait` waits until it is final. `--kind` skips the lookup of
the other kind.

### storeshot pull

```sh
storeshot pull <id> --out <dir> [--layout store|fastlane] [--force] [--kind set|generation]
```

Saves the images of a finished set (what succeeded, if some failed) or generation.

### storeshot schema

`storeshot schema` lists the JSON Schemas. `storeshot schema <command>` (or `envelope`,
`captions`) prints one. It works offline.

## Live credits

- **Test is the default.** Live is used only with a live key (`--api-key` or
  `STORESHOT_API_KEY`), `--env live` or `STORESHOT_ENVIRONMENT=live`. A key of the other
  environment than `--env` is an error.
- Before a live charge, the CLI knows the cost: the free quote of a set, or 1 credit per image of
  `generate`. Then:
  1. `--max-credits <n>`: over `n` → exit 11, nothing created (`0` proves a run is free).
  2. Not enough credits → exit 4, nothing created.
  3. `--yes`, or answering `y` at the prompt on a terminal → the jobs are created. Otherwise (CI,
     pipes, `--json`) → exit 11 with the quote, nothing created.
- Failed or canceled images are refunded automatically.

## JSON output

With `--json`, stdout carries exactly one JSON document, also on errors and Ctrl-C. Logs and
progress go to stderr.

```json
{
  "schemaVersion": 1,
  "command": "set",
  "ok": true,
  "exitCode": 0,
  "data": { "mode": "set", "set": { "id": "…", "status": "succeeded" } },
  "warnings": [],
  "error": null
}
```

On failure `ok` is `false` and `error` has `code`, `message`, `hint`, `status`, `requestId`,
`docUrl`, `retryAfterSeconds` and, when useful, `details`. `data` still holds what is known (a
partial set, a quote, the job id).

Each command has a JSON Schema (2020-12) in the package's `schemas/` folder, printed by
`storeshot schema <command>`. Within `schemaVersion` 1 changes are additive (new optional fields,
new error codes). Anything else gets a new `schemaVersion`.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | ok                                                                    |
| 1    | internal error                                                        |
| 2    | usage or invalid request                                              |
| 3    | not logged in, or the key is invalid or lacks a scope                 |
| 4    | not enough credits                                                    |
| 5    | not found                                                             |
| 6    | rate limited (see `retryAfterSeconds`)                                |
| 7    | server error                                                          |
| 8    | network error or timeout                                              |
| 9    | the job ended and some images failed (refunded)                       |
| 10   | still running: the wait timed out (the job continues)                 |
| 11   | live spend not confirmed (`--yes`), declined, or over `--max-credits` |
| 12   | local file problem (type, size, existing file, unsafe path)           |
| 130  | interrupted (Ctrl-C): the job, if any, continues                      |
| 143  | terminated (SIGTERM)                                                  |

## Credentials

- `storeshot login` stores its key in `~/.config/storeshot/cli-credentials.json` (or under
  `$XDG_CONFIG_HOME/storeshot/`). The file is mode 0600 in a 0700 folder. A file other users can
  read is ignored with a warning.
- The MCP server (`@draggable/storeshot-mcp`) uses the same folder but its own file, so each tool
  links once and each key can be revoked on its own.
- `storeshot logout` forgets the key on this machine. Revoke it at
  https://console.storeshot.art/keys.
- A key from `--api-key` or `STORESHOT_API_KEY` is never written to disk. Keys are never printed:
  output shows only a key's first characters.
- On Windows the file has no POSIX modes: your user profile's permissions protect it.

## Files

- Input screenshots are read only when named (and, for `set`, listed in `captions.json`), checked
  by their bytes, and must be PNG, JPEG or WebP of at most 20 MiB. Nothing is uploaded if one
  file fails the check.
- Downloads go only inside `--out`. Existing files are never replaced without `--force`, and
  nothing is written through symbolic links. A failed download removes what it wrote.

## Troubleshooting

- `needs Node.js 18.3 or later`: update Node.js.
- `NOT_LOGGED_IN` (exit 3): run `storeshot login`, or set `STORESHOT_API_KEY`.
- `CONFIRMATION_REQUIRED` (exit 11): a live key needs `--yes` outside a terminal.
- `FILE_EXISTS` (exit 12): pass `--force` or another `--out`.
- Exit 10: the job is still running. Use `storeshot status <id> --wait`, then `storeshot pull <id>`.

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`).

## Source of truth

This repository is generated from the Storeshot monorepo, where the CLI is developed together with
the API, the SDK it uses and the MCP server it shares code with (`vendor/mcp/`, see its README).
Every Storeshot release that changes the CLI replaces the contents of this repository with one
commit tagged `vX.Y.Z`.

Issues and pull requests are welcome here. Accepted changes are applied upstream and arrive with
the next release, so a pull request is closed rather than merged.

Every `vX.Y.Z` tag pushed here is published to npm (with npm provenance) by
`.github/workflows/publish.yml`.

### Development and tests

```sh
npm ci
npm run typecheck
npm test                # unit tests, --json schemas and snapshots
npm run build
npm run test:bin        # the built CLI against a fake API (exit codes, Ctrl-C)
npm run check:package   # the package exactly as npm would publish it, run as `storeshot`
```
