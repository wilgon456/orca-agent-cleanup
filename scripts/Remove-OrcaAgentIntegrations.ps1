[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter()]
    [switch]$Apply,

    [Parameter()]
    [switch]$IncludeAppData,

    [Parameter()]
    [string]$BackupRoot,

    [Parameter()]
    [string]$HomeDirectory = [Environment]::GetFolderPath('UserProfile'),

    [Parameter()]
    [string]$RoamingAppData = [Environment]::GetFolderPath('ApplicationData'),

    [Parameter()]
    [string]$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData'),

    [Parameter()]
    [switch]$SkipPathCleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$auditScript = Join-Path $scriptRoot 'Get-OrcaAgentResidue.ps1'

if (-not $Apply -and -not $WhatIfPreference) {
    Write-Host 'Audit mode: no changes will be made.' -ForegroundColor Cyan
    & $auditScript -HomeDirectory $HomeDirectory -RoamingAppData $RoamingAppData -LocalAppData $LocalAppData
    Write-Host "`nRun again with -Apply after reviewing the findings." -ForegroundColor Cyan
    return
}

$homeFull = [IO.Path]::GetFullPath($HomeDirectory)
$roamingFull = [IO.Path]::GetFullPath($RoamingAppData)
$localFull = [IO.Path]::GetFullPath($LocalAppData)
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path (Join-Path $homeFull 'OrcaAgentCleanupBackups') $timestamp
}
$backupFull = [IO.Path]::GetFullPath($BackupRoot)

function Assert-ExactChildPath {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    if (-not $fullPath.StartsWith($fullRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside approved root: $fullPath"
    }
    return $fullPath
}

function Write-Utf8Json {
    param(
        [object]$InputObject,
        [string]$Path
    )

    $json = $InputObject | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Backup-File {
    param(
        [string]$Source,
        [string]$RelativeDestination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }
    $destination = Join-Path $backupFull $RelativeDestination
    if ($PSCmdlet.ShouldProcess($Source, "Back up to $destination")) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $destination -Force
    }
}

function Move-ToQuarantine {
    param(
        [string]$Source,
        [string]$AllowedRoot,
        [string]$RelativeDestination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }

    $safeSource = Assert-ExactChildPath -Path $Source -AllowedRoot $AllowedRoot
    $destination = Join-Path $backupFull $RelativeDestination
    $sourcePrefix = $safeSource.TrimEnd('\') + '\'
    if ($backupFull -ieq $safeSource -or $backupFull.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing backup directory inside cleanup target: $safeSource"
    }
    if (Test-Path -LiteralPath $destination) {
        throw "Quarantine destination already exists: $destination"
    }

    if ($PSCmdlet.ShouldProcess($safeSource, "Move to quarantine: $destination")) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Move-Item -LiteralPath $safeSource -Destination $destination
    }
}

$agentsRoot = Join-Path $homeFull '.agents'
$skillRoot = Join-Path $agentsRoot 'skills'
$lockPath = Join-Path $agentsRoot '.skill-lock.json'
$claudeSettingsPath = Join-Path (Join-Path $homeFull '.claude') 'settings.json'
$orcaSkillNames = @(
    'computer-use',
    'linear-tickets',
    'orca-cli',
    'orca-emulator',
    'orca-emulator-android',
    'orca-linear',
    'orca-per-workspace-env',
    'orchestration'
)
$provenSkills = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

if ($PSCmdlet.ShouldProcess($backupFull, 'Create backup directory')) {
    New-Item -ItemType Directory -Path $backupFull -Force | Out-Null
}

if (Test-Path -LiteralPath $lockPath) {
    $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
    $lockSkillsProperty = $lock.PSObject.Properties['skills']
    if ($null -ne $lockSkillsProperty) {
        $lockSkills = $lockSkillsProperty.Value
        foreach ($property in @($lockSkills.PSObject.Properties)) {
            $entry = $property.Value
            $sourceProperty = $entry.PSObject.Properties['source']
            $sourceUrlProperty = $entry.PSObject.Properties['sourceUrl']
            $source = if ($null -ne $sourceProperty) { [string]$sourceProperty.Value } else { '' }
            $sourceUrl = if ($null -ne $sourceUrlProperty) { [string]$sourceUrlProperty.Value } else { '' }
            if ($source -ieq 'stablyai/orca' -or $sourceUrl -match '(?i)github\.com/stablyai/orca(?:\.git)?(?:$|[/#?])') {
                [void]$provenSkills.Add($property.Name)
            }
        }
    }

    if ($provenSkills.Count -gt 0) {
        Backup-File -Source $lockPath -RelativeDestination 'config\agents-skill-lock.json'
        if ($PSCmdlet.ShouldProcess($lockPath, "Remove stablyai/orca lock entries: $($provenSkills -join ', ')")) {
            foreach ($name in @($provenSkills)) {
                $lockSkills.PSObject.Properties.Remove($name)
            }
            Write-Utf8Json -InputObject $lock -Path $lockPath
        }
    }
}

$candidateSkillNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($name in $orcaSkillNames) {
    [void]$candidateSkillNames.Add($name)
}
foreach ($name in $provenSkills) {
    [void]$candidateSkillNames.Add($name)
}

foreach ($name in $candidateSkillNames) {
    $folder = Join-Path $skillRoot $name
    if (-not (Test-Path -LiteralPath $folder)) {
        continue
    }

    $skillFile = Join-Path $folder 'SKILL.md'
    $signatureMatch = $false
    if (Test-Path -LiteralPath $skillFile) {
        $signatureMatch = [bool](Select-String -Quiet -LiteralPath $skillFile -Pattern "(?i)(?:^|[/:\s])stablyai/orca(?:\.git)?(?:$|[/#?\s])|Orca's computer-use CLI|ORCA skills get|Engage Orca")
    }

    if ($provenSkills.Contains($name) -or $signatureMatch) {
        Move-ToQuarantine -Source $folder -AllowedRoot $skillRoot -RelativeDestination (Join-Path 'skills' $name)
    }
    else {
        Write-Warning "Skipped '$folder': the name matched, but Orca provenance was not confirmed."
    }
}

if (Test-Path -LiteralPath $claudeSettingsPath) {
    $settings = Get-Content -Raw -LiteralPath $claudeSettingsPath | ConvertFrom-Json
    $settingsChanged = $false
    $hooksProperty = $settings.PSObject.Properties['hooks']

    if ($null -ne $hooksProperty) {
        $hooks = $hooksProperty.Value
        foreach ($eventName in @($hooks.PSObject.Properties.Name)) {
            $eventProperty = $hooks.PSObject.Properties[$eventName]
            $keptGroups = [System.Collections.Generic.List[object]]::new()

            foreach ($group in @($eventProperty.Value)) {
                $originalHooks = @($group.hooks)
                $keptHooks = @($originalHooks | Where-Object {
                    [string]$_.command -notmatch '(?i)\.orca[\\/]agent-hooks'
                })
                if ($keptHooks.Count -ne $originalHooks.Count) {
                    $settingsChanged = $true
                }

                if ($keptHooks.Count -gt 0) {
                    $group.hooks = $keptHooks
                    $keptGroups.Add($group)
                }
                else {
                    $settingsChanged = $true
                }
            }

            if ($keptGroups.Count -eq 0) {
                $hooks.PSObject.Properties.Remove($eventName)
                $settingsChanged = $true
            }
            elseif ($keptGroups.Count -ne @($eventProperty.Value).Count) {
                $eventProperty.Value = @($keptGroups)
                $settingsChanged = $true
            }
        }

        if (@($hooks.PSObject.Properties).Count -eq 0) {
            $settings.PSObject.Properties.Remove('hooks')
            $settingsChanged = $true
        }
    }

    $statusLineProperty = $settings.PSObject.Properties['statusLine']
    if ($null -ne $statusLineProperty -and [string]$statusLineProperty.Value.command -match '(?i)\.orca[\\/]agent-hooks') {
        $settings.PSObject.Properties.Remove('statusLine')
        $settingsChanged = $true
    }

    if ($settingsChanged) {
        Backup-File -Source $claudeSettingsPath -RelativeDestination 'config\claude-settings.json'
        if ($PSCmdlet.ShouldProcess($claudeSettingsPath, 'Remove Orca-only hooks and status line')) {
            Write-Utf8Json -InputObject $settings -Path $claudeSettingsPath
        }
    }
}

$sharedOrcaState = Join-Path $homeFull '.orca'
foreach ($entry in @('agent-hooks', 'claude-agent-teams-bin', 'managed-hook-install.lock', 'openai-speech-token.enc')) {
    Move-ToQuarantine -Source (Join-Path $sharedOrcaState $entry) -AllowedRoot $sharedOrcaState -RelativeDestination (Join-Path 'data\dot-orca' $entry)
}

if ($IncludeAppData) {
    Move-ToQuarantine -Source (Join-Path $roamingFull 'Orca') -AllowedRoot $roamingFull -RelativeDestination 'data\roaming-Orca'
    Move-ToQuarantine -Source (Join-Path $localFull 'Orca') -AllowedRoot $localFull -RelativeDestination 'data\local-Orca'
}

if (-not $SkipPathCleanup) {
    $orcaBin = Join-Path $localFull 'Programs\orca\resources\bin'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
        $newEntries = @($userPath -split ';' | Where-Object {
            $_ -and $_.Trim().TrimEnd('\') -ine $orcaBin.TrimEnd('\')
        })
        $newPath = $newEntries -join ';'

        if ($newPath -ne $userPath -and $PSCmdlet.ShouldProcess('User PATH', "Remove exact entry: $orcaBin")) {
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            $env:Path = (@($env:Path -split ';' | Where-Object {
                $_ -and $_.Trim().TrimEnd('\') -ine $orcaBin.TrimEnd('\')
            }) -join ';')
        }
    }
}

Write-Host "Cleanup finished. Backup/quarantine: $backupFull" -ForegroundColor Green
Write-Host 'Restart Claude and Codex so they reload their skill catalogs.' -ForegroundColor Yellow
