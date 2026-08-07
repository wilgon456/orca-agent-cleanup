[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cleaner = Join-Path $repoRoot 'scripts\Remove-OrcaAgentIntegrations.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('orca-agent-cleanup-test-' + [guid]::NewGuid().ToString('N'))
$testHome = Join-Path $testRoot 'home'
$roaming = Join-Path $testRoot 'roaming'
$local = Join-Path $testRoot 'local'
$backup = Join-Path $testRoot 'backup'
$secondBackup = Join-Path $testRoot 'backup-second-run'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

try {
    $orcaSkill = Join-Path $testHome '.agents\skills\computer-use'
    $futureOrcaSkill = Join-Path $testHome '.agents\skills\agent-link'
    $paseoSkill = Join-Path $testHome '.agents\skills\paseo'
    $claudeDir = Join-Path $testHome '.claude'
    New-Item -ItemType Directory -Path $orcaSkill, $futureOrcaSkill, $paseoSkill, $claudeDir, (Join-Path $testHome '.orca\agent-hooks'), (Join-Path $roaming 'Orca'), (Join-Path $local 'Orca') -Force | Out-Null

    Set-Content -LiteralPath (Join-Path $orcaSkill 'SKILL.md') -Encoding UTF8 -Value "Use Orca's computer-use CLI. Run ORCA skills get computer-use."
    Set-Content -LiteralPath (Join-Path $futureOrcaSkill 'SKILL.md') -Encoding UTF8 -Value 'Future Orca integration skill.'
    Set-Content -LiteralPath (Join-Path $paseoSkill 'SKILL.md') -Encoding UTF8 -Value 'Paseo reference.'
    Set-Content -LiteralPath (Join-Path $testHome '.orca\agent-hooks\claude-hook.cmd') -Encoding UTF8 -Value '@echo off'
    Set-Content -LiteralPath (Join-Path $testHome '.orca\user-worktree.txt') -Encoding UTF8 -Value 'keep user work'
    Set-Content -LiteralPath (Join-Path $roaming 'Orca\state.json') -Encoding UTF8 -Value '{}'
    Set-Content -LiteralPath (Join-Path $local 'Orca\state.json') -Encoding UTF8 -Value '{}'

    $lock = @{
        version = 3
        skills = [ordered]@{
            'computer-use' = @{
                source = 'stablyai/orca'
                sourceUrl = 'https://github.com/stablyai/orca.git'
            }
            'agent-link' = @{
                source = 'stablyai/orca'
                sourceUrl = 'https://github.com/stablyai/orca.git'
            }
            'find-skills' = @{
                source = 'vercel-labs/skills'
                sourceUrl = 'https://github.com/vercel-labs/skills.git'
            }
        }
    }
    New-Item -ItemType Directory -Path (Join-Path $testHome '.agents') -Force | Out-Null
    $lock | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $testHome '.agents\.skill-lock.json') -Encoding UTF8

    $settings = @{
        theme = 'dark'
        hooks = @{
            PreToolUse = @(
                @{
                    matcher = '*'
                    hooks = @(
                        @{ type = 'command'; command = 'C:/Users/test/.orca/agent-hooks/claude-hook.cmd' },
                        @{ type = 'command'; command = 'Write-Output keep-me' }
                    )
                }
            )
        }
        statusLine = @{ type = 'command'; command = 'C:/Users/test/.orca/agent-hooks/claude-statusline.cmd' }
    }
    $settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $claudeDir 'settings.json') -Encoding UTF8

    & $cleaner -Apply -IncludeAppData -HomeDirectory $testHome -RoamingAppData $roaming -LocalAppData $local -BackupRoot $backup -SkipPathCleanup -Confirm:$false

    Assert-True -Condition (-not (Test-Path -LiteralPath $orcaSkill)) -Message 'Orca computer-use skill should be quarantined'
    Assert-True -Condition (-not (Test-Path -LiteralPath $futureOrcaSkill)) -Message 'Any lock-proven Orca skill should be quarantined'
    Assert-True -Condition (Test-Path -LiteralPath $paseoSkill) -Message 'Paseo skill must remain untouched'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $testHome '.orca\agent-hooks'))) -Message 'Orca agent-hooks should be quarantined'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $testHome '.orca\user-worktree.txt')) -Message 'Unrelated ~/.orca user files should be preserved'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $roaming 'Orca'))) -Message 'Roaming Orca data should be quarantined'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $local 'Orca'))) -Message 'Local Orca data should be quarantined'

    $cleanLock = Get-Content -Raw -LiteralPath (Join-Path $testHome '.agents\.skill-lock.json') | ConvertFrom-Json
    Assert-True -Condition ($null -eq $cleanLock.skills.PSObject.Properties['computer-use']) -Message 'Orca lock entry should be removed'
    Assert-True -Condition ($null -ne $cleanLock.skills.PSObject.Properties['find-skills']) -Message 'Unrelated lock entry should remain'

    $cleanSettings = Get-Content -Raw -LiteralPath (Join-Path $claudeDir 'settings.json') | ConvertFrom-Json
    $commands = @($cleanSettings.hooks.PreToolUse[0].hooks | ForEach-Object { [string]$_.command })
    Assert-True -Condition ($commands -contains 'Write-Output keep-me') -Message 'Unrelated Claude hook should remain'
    Assert-True -Condition (-not ($commands -match '\.orca[\\/]agent-hooks')) -Message 'Orca Claude hook should be removed'
    Assert-True -Condition ($null -eq $cleanSettings.PSObject.Properties['statusLine']) -Message 'Orca status line should be removed'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $backup 'skills\computer-use')) -Message 'Skill backup should exist'

    & $cleaner -Apply -IncludeAppData -HomeDirectory $testHome -RoamingAppData $roaming -LocalAppData $local -BackupRoot $secondBackup -SkipPathCleanup -Confirm:$false

    Write-Host 'Smoke test passed.' -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
