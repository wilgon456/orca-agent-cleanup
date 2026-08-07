# Orca Agent Cleanup

Safely audit and disable agent integrations left behind by a
[`stablyai/orca`](https://github.com/stablyai/orca) installation on Windows.

Windows에서 Orca 제거 후에도 Claude Code나 Codex가 계속 Orca CLI를 선택하는
문제를 진단하고 정리하는 PowerShell 도구입니다.

This community project is not affiliated with or endorsed by the Orca project.

## What it cleans

- Shared skills installed from `stablyai/orca`:
  - `orca-cli`
  - `computer-use`
  - `orchestration`
- Matching entries in `~/.agents/.skill-lock.json`
- Orca commands registered in Claude Code hooks and status line
- `~/.orca` agent hooks for Claude, Codex, and other agents
- The stale Orca CLI entry in the user `PATH`
- Optional Orca data under `%APPDATA%` and `%LOCALAPPDATA%`
- Optional `~/orca` workspace data

The cleaner checks provenance before touching a skill folder. A different
vendor's `computer-use` skill is not removed merely because it has the same
name.

## What it does not clean

- Paseo skills or Paseo data
- OpenAI's bundled `computer-use` plugin
- Unrelated Claude Code hooks
- Orca application binaries while Orca is still installed
- Historical chat logs and harmless references in old session history

If Orca is still installed, uninstall the application from Windows Settings
first, close Claude/Codex/Orca, and then run this cleaner.

## Quick start

Requires Windows PowerShell 5.1 or PowerShell 7.

```powershell
git clone https://github.com/wilgon456/orca-agent-cleanup.git
cd orca-agent-cleanup

# Audit only. Makes no changes.
.\scripts\Get-OrcaAgentResidue.ps1

# Preview the cleanup.
.\scripts\Remove-OrcaAgentIntegrations.ps1 -Apply -IncludeAppData -WhatIf

# Back up and quarantine active integrations and Orca app data.
.\scripts\Remove-OrcaAgentIntegrations.ps1 -Apply -IncludeAppData
```

To quarantine `~/orca` as well, add `-IncludeWorkspaceData`. This directory can
contain real Git worktrees, so it is never included by default.

```powershell
.\scripts\Remove-OrcaAgentIntegrations.ps1 `
  -Apply `
  -IncludeAppData `
  -IncludeWorkspaceData
```

## Safety model

The script does not permanently delete matched data. It creates a timestamped
backup directory under `~/OrcaAgentCleanupBackups` and moves matched directories
there. Configuration files are copied before they are edited.

After confirming that new Claude and Codex sessions work normally, you may
delete that backup directory manually to reclaim disk space.

Always run the audit and `-WhatIf` preview first. Do not run cleanup scripts
copied from the internet without reviewing them.

## Options

| Option | Effect |
| --- | --- |
| `-Apply` | Enables changes. Without it, the script only audits. |
| `-WhatIf` | Shows the changes without applying them. |
| `-IncludeAppData` | Quarantines `%APPDATA%\Orca` and `%LOCALAPPDATA%\Orca`. |
| `-IncludeWorkspaceData` | Quarantines `~/orca`, which may contain worktrees. |
| `-BackupRoot <path>` | Uses a custom quarantine directory. |
| `-SkipPathCleanup` | Leaves the user `PATH` unchanged. Useful for testing. |

## Validate the script

The smoke test creates a synthetic home directory, runs the cleaner against it,
and verifies that unrelated skills and hooks survive.

```powershell
.\tests\Invoke-SmokeTest.ps1
```

## Restoring

Each run prints its backup directory. Restore the copied configuration files
and move quarantined directories back to their original locations. Close all
Claude, Codex, and Orca processes before restoring.

## Contributing

Bug reports and pull requests are welcome. Please include the PowerShell
version, the audit output with secrets removed, and whether Orca was already
uninstalled.
