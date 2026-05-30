# Driving a worktree build on the real CoreS3

When verifying a worktree build of m5ct on the physical CoreS3, the blocker is that **a Claude Code session's own statusline is `m5ct-statusline`**, whose `ensureDaemon()` respawns the *installed global* `m5ctd` (`~/.nvm/.../bin/m5ctd`) on each render and grabs the serial port. So `kill`-ing the daemon is futile and a worktree daemon loses the port.

What actually works:

- **Flashing your worktree firmware** (`pio run -e cores3-se -t upload`): send the daemon `{op:'flashHold',client:'x'}` over `~/.m5stack-coding-toys/daemon.sock` (it closes the port + goes `Held`, auto-releases after 60s), upload, run `esptool.py --port /dev/cu.usbmodem1101 --after watchdog_reset run` to boot the app, then `{op:'flashRelease',client:'x'}`. `m5ct flash` only flashes *released* firmware, not your build. CoreS3 still needs human long-press RESET to enter download mode before upload; the watchdog reset only replaces the post-upload manual RESET.
- **Running your worktree daemon as the active one**: it must hold the default socket + pidfile, because `ensureDaemon` skips spawning when those exist with a live pid. To win the startup race against the respawned global (same version → singleton makes yours exit), **bump the version so yours supersedes**: `M5CT_VERSION` is baked by esbuild `define` (env override won't work on the dist), so `sed -i '' 's/"0.1.0"/"99.0.0"/' packages/cli/dist/m5ctd.js` (single occurrence) then run that dist on the default HOME. It supersedes the global once; thereafter `ensureDaemon` sees your live pid and stops respawning. Revert the sed when done.
- **Driving activity states without real CC events**: post to the socket — `{statusLine:{...}}` first (sets active + satisfies the idle guard), then `{event:'Stop'|'Notification'|'UserPromptSubmit'}` to flip the badge. statusLine ticks preserve the current activity.

Start daemons via the harness's background-process mode, never a detached shell `&` (orphans grab the serial port). Flashing coordination details are in the `m5stack-cores3-bring-up` skill. Daemon singleton mechanics: [daemon-singleton-and-install.md](daemon-singleton-and-install.md).
