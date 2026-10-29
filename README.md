<div align="center">

![Orca Agent Cleanup](https://raw.githubusercontent.com/wilgon456/orca-agent-cleanup/main/docs/readme-banner.svg)

# Orca Agent Cleanup

Inspect leftover Orca integrations, quarantine verified residue and restore it when needed.

**English** · [한국어](https://github.com/wilgon456/orca-agent-cleanup/blob/main/README.ko.md)

![project: utility](https://img.shields.io/badge/project-utility-22d3ee?style=flat-square) ![stack: Node.js 18+](https://img.shields.io/badge/stack-Node.js%2018%2B-22d3ee?style=flat-square) [![License](https://img.shields.io/badge/license-MIT-22d3ee?style=flat-square)](https://github.com/wilgon456/orca-agent-cleanup/blob/main/LICENSE)

[Quick start](#quick-start) · [Coverage](#cleanup-coverage) · [Restore](#restore)

</div>

---

> [!IMPORTANT]
> This is an independent community tool, unaffiliated with Orca or Stably. Uninstall the Orca app normally and close related coding-agent sessions before applying cleanup.

## Why use it

Removing Orca can leave shared skills, agent hooks, launchers, cached models and configuration behind. Agents may keep trying to call a missing Orca CLI or computer-use integration. This tool identifies residue using a reviewed Orca manifest, ownership markers and signatures, then moves verified items into a recoverable backup.

It does **not** uninstall the Orca application itself.

## Quick start

Requires **Node.js 18 or newer**. The commands work in Windows PowerShell, macOS Terminal and Linux shells. Run it with `npx`; nothing needs to be installed.

```bash
npx orca-agent-cleanup scan
```

You can also clone the repository and replace `npx orca-agent-cleanup` with `node scripts/orca-agent-cleanup.mjs` in the commands below.

```bash
git clone https://github.com/wilgon456/orca-agent-cleanup.git
cd orca-agent-cleanup
```

**Inspect** without changing files:

```bash
npx orca-agent-cleanup scan
```

**Preview** cleanup including application data, voice data and leftover Orca processes. If Orca is still installed or running you will see a ⛔ warning; uninstall the app first.

```bash
npx orca-agent-cleanup clean --dry-run --include-app-data --include-voice-data --stop-processes
```

**Apply** the reviewed cleanup:

```bash
npx orca-agent-cleanup clean --include-app-data --include-voice-data --stop-processes
```

The command reports the backup location. Replace the placeholder below with that actual path:

```bash
npx orca-agent-cleanup verify --manifest /path/to/backup/manifest.json
```

Restart your coding agents and terminals afterward so their cached skill lists and environment variables are refreshed.

## Cleanup coverage

| Target | Included by default? |
| --- | --- |
| Ten reviewed Orca skills and signed copies in Codex plugin caches | Yes, after ownership verification |
| Orca-managed agent hooks and marked extensions (24 agent integrations, see below) | Yes |
| Verified user CLI launchers and Orca PATH entries | Yes |
| Orca background processes left running after the app was removed | `--stop-processes` |
| Managed hooks and Orca-encrypted credentials under `~/.orca` | Yes |
| App data and its default voice models | `--include-app-data` |
| Separate voice caches and custom model locations | `--include-voice-data` |
| Running WSL distributions | `--include-wsl` |
| Accessible remote homes | `--include-remote` |
| All user state under `~/.orca` | `--include-user-state` |
| Project `.orca` state and adjacent worktree trash | `--include-project-state` |

Hook cleanup follows every agent integration in Orca's `src/main/*/hook-service.ts`: Claude, OpenClaude, Codex, Gemini, Antigravity, Cursor, Command Code, Droid, Copilot, Grok, Devin, Kimi, Amp, Hermes, Qoder (including Qoder CN), Qwen Code, CodeBuddy, ZCode, Kiro (each agent file in `~/.kiro/agents`), Muse, jcode, DeepSeek Harness (`~/.dsh/cordis.patch.yml`), OpenCode (status plugins and `tui.json` registrations) and MiMo Code (inside app data). Windows hook commands wrapped in PowerShell or `-EncodedCommand` are decoded before matching. Only Orca entries are removed; the rest of each file is kept.

The credential files are `openai-speech-token.enc`, `bitbucket-credential.*`, `linear-token.enc`, `linear-workspaces.json`, `jira-tokens`, `jira-sites.json`, `zcode-plan-api-key.enc`, `opencode-go-api-key.enc` and `minimax-*.enc`. Orca encrypts them with its own app key, so they are useless once the app is gone. Other files under `~/.orca`, such as worktrees and `keybindings.json`, stay unless you pass `--include-user-state`.

The reviewed Orca v1.4.243 skill names are `computer-use`, `orca-cli`, `orchestration`, `orca-per-workspace-env`, `orca-emulator`, `orca-emulator-android`, `orca-linear`, `linear-tickets`, `orca-jira` and `jira-tickets`. A matching name alone is insufficient: unrelated providers' skills, including OpenAI's computer-use and Paseo skills, are preserved. The other cleanup contracts remain based on the v1.4.224 review; changes in later Orca versions have not all been assessed.

## Platforms

| Platform | Relevant locations |
| --- | --- |
| Windows 10 / 11 | User skill folders, `%APPDATA%`, `%LOCALAPPDATA%`, verified `ProgramData` / `Public` voice caches and user PATH |
| macOS | User skill folders, Stably app data under `~/Library`, verified `/usr/local/bin/orca` and `~/.local/bin/orca` launchers |
| Linux | Orca config/cache directories, AppImage cache, official `orca-ide` launcher and marked Orca dispatcher |

Linux's `/usr/bin/orca` is the GNOME screen reader and is never targeted. System-managed or headless-server installations are outside automatic cleanup.

## Safeguards

- `scan` is read-only; `clean --dry-run` previews the proposed operations.
- File names are checked together with provenance and Orca-specific markers.
- Targets are quarantined rather than permanently deleted.
- Configuration changes remove identified Orca entries while preserving unrelated settings and saving the original.
- Manifest v2 is written before cleanup and updated around each operation so interrupted runs can be recovered.
- File and directory SHA-256 hashes support backup verification.
- Default backup folders include a UUID; unsafe or nonempty custom destinations are rejected.
- Items with insufficient provenance are reported as `unverified` and left alone.

Default backups live under `~/OrcaAgentCleanupBackups/<timestamp-UUID>/`. They contain `manifest.json`, original configurations and categorized quarantined files.

## Restore

Close related applications, verify the backup, then preview restoration:

```bash
npx orca-agent-cleanup verify --manifest /path/to/backup/manifest.json
npx orca-agent-cleanup restore --dry-run --manifest /path/to/backup/manifest.json
npx orca-agent-cleanup restore --manifest /path/to/backup/manifest.json
```

Manifest v1 backups remain supported, but they lack the content hashes recorded by v2. An `in-progress` v2 journal can recover operations that reached the backup even if the original cleanup was interrupted.

If a restore destination has changed, its current contents are preserved in `restore-conflicts/` before the original is restored. Restoration writes a separate report and skips identical items already restored. Keep the backup until you have checked that your agents work correctly.

## Options

| Option | Purpose |
| --- | --- |
| `scan`, `clean`, `verify`, `restore` | Inspect, quarantine, verify integrity or recover |
| `--dry-run` | Preview cleanup or restoration |
| `--stop-processes` | Stop Orca background processes left running without the app; not restorable |
| `--force` | Clean even while Orca is installed or running; not recommended because the app reinstalls its hooks |
| `--project <path>` | Add a project's skill folders; repeatable |
| `--include-app-data`, `--include-voice-data` | Include explicitly selected application / voice residue |
| `--voice-model-path <path>` | Add a custom voice model path; repeatable |
| `--include-wsl`, `--wsl-home <path>` | Inspect running WSL distributions or specified WSL homes |
| `--include-remote`, `--remote-home <path>` | Include an accessible remote home; no automatic SSH login |
| `--include-user-state` | Quarantine all `~/.orca` state, including sessions and credentials |
| `--include-project-state` | Include the selected project's `.orca` state and worktree trash |
| `--backup-root <path>` | Choose a backup destination |
| `--manifest <path>` | Select a backup for verification or restoration |
| `--json` | Return structured output |

Use `npx orca-agent-cleanup --help` for the complete interface. In PowerShell, use single-line commands or PowerShell backticks rather than Bash line continuations.

## Boundaries

Automatic cleanup does not remove the app, change macOS privacy permissions, uninstall Windows app entries, delete package-managed Linux installations, start stopped WSL distributions or log into SSH hosts. It preserves unverified skills, user source/workspaces, historical chats and credentials belonging to other software.

The app can be uninstalled through Windows Settings, the macOS Applications folder or the Linux installation method you originally used. Complete that step before cleaning its integrations.

## Version 1.5.2

The two Jira skills added by Orca are included in the reviewed skill names.
CodeBuddy, Kiro and OpenClaude skill roots are checked in the home and in
explicitly selected projects; `KIRO_HOME` and `OPENCLAUDE_CONFIG_DIR` are also
checked when set. The same ownership checks, preview, backup and restore rules
apply. Other upstream changes after the v1.4.224 contract review still need
separate assessment.

## Version 1.5.0

This version runs with `npx orca-agent-cleanup`. `clean` now stops when the Orca app is still installed or running, because Orca reinstalls its hooks and plugins on launch and quarantining its credentials would break a working app; `--force` overrides this. Orca terminal daemons left running after uninstalling are reported by executable location and stopped with `--stop-processes`. Files Orca creates outright, such as Copilot `hooks/orca.json` and Grok `hooks/orca-status.json`, are quarantined whole instead of being left as empty shells when nothing but Orca entries remain.

## Version 1.4.0

This version is checked against Orca v1.4.224 and the 2026-10-14 `main` branch. It adds hook cleanup for Qoder, Qwen Code, CodeBuddy, ZCode, Kiro, Muse, jcode, DeepSeek Harness and OpenCode, catches PowerShell-wrapped and base64-encoded Windows hook commands, quarantines Orca's newer encrypted credentials, scans three new skill folders and makes the upstream monitor flag new or removed agent integrations.

## Version 1.3.0

Version 1.3.0 added Linux AppImage and signed plugin-cache coverage, recovery journals, backup hashes, UUID destinations, upstream contract monitoring, SHA-pinned Actions and Node.js 24 / CodeQL checks.

## Development

Tests use temporary fixture homes rather than real user settings:

```bash
node --test tests/orca-agent-cleanup.test.mjs
```

The legacy Windows interface remains available:

```powershell
.\scripts\Get-OrcaAgentResidue.ps1
.\scripts\Remove-OrcaAgentIntegrations.ps1 -Apply -IncludeAppData -WhatIf
.\tests\Invoke-SmokeTest.ps1
```

See [SECURITY.md](https://github.com/wilgon456/orca-agent-cleanup/blob/main/SECURITY.md) for vulnerability reporting. For bug reports, include the OS, whether Orca was uninstalled, a redacted scan result and the expected versus observed behavior.

## License

[MIT](https://github.com/wilgon456/orca-agent-cleanup/blob/main/LICENSE).
