# Daemon singleton, distribution & install

Distribution is **pure npm, NO Claude Code plugin** (a plugin can't set `statusLine` — only `agent`/`subagentStatusLine` — so a CLI is unavoidable; ccstatusline is npm-only precedent).

ONE publishable package **`m5ct`** (`packages/cli`, `name:"m5ct"`) bundles THREE bins via `build.mjs` (esbuild, `serialport` external, daemon+shim source bundled in; the workspace `@m5stack-coding-toys/*` pkgs are devDeps): `m5ct` / `m5ctd` / `m5ct-statusline`. `version()` reads `process.env.M5CT_VERSION` stamped by esbuild `define`.

## Daemon singleton

`singleton.ts`: lockfile acquire/supersede + `shouldExitIdle`, wired in `main.ts` (acquires before binding port; bounded 3s wait for old PID on supersede). Plus **idle self-exit** (`policy.idle_exit_ms` default 600k).

Same-version singleton means a fresh local daemon DEFERS to an already-running same-version one — **kill stale `m5ctd` before testing new daemon code**. To force a worktree daemon to win, see [driving-a-worktree-build-on-device.md](driving-a-worktree-build-on-device.md).

## Global install is a symlink

`which m5ctd` → `packages/cli/dist/m5ctd.js` (npm-linked). So `pnpm --filter m5ct build` updates the global; the statusLine shim then spawns the new daemon.

## `m5ct install` / `uninstall`

Really write `~/.claude/settings.json` (backs up to `.m5ct-bak` once, **chains** any existing statusLine via `~/.m5stack-coding-toys/config.json`, restores on uninstall). The shim (`chain.ts` + `bootstrap.ts`) replays the chained command's stdout for the terminal + lazily detached-spawns the daemon, never crashes CC.

See also: [adding-a-host-device-rpc.md](adding-a-host-device-rpc.md).
