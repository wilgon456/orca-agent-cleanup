[CmdletBinding()]
param(
    [Parameter()]
    [string]$HomeDirectory = [Environment]::GetFolderPath('UserProfile'),

    [Parameter()]
    [string]$RoamingAppData = [Environment]::GetFolderPath('ApplicationData'),

    [Parameter()]
    [string]$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData'),

    [Parameter()]
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$orcaSkillNames = @('orca-cli', 'computer-use', 'orchestration')
$agentsRoot = Join-Path $HomeDirectory '.agents'
$skillRoot = Join-Path $agentsRoot 'skills'
$lockPath = Join-Path $agentsRoot '.skill-lock.json'
$claudeSettingsPath = Join-Path (Join-Path $HomeDirectory '.claude') 'settings.json'
$orcaHookRoot = Join-Path $HomeDirectory '.orca'
$roamingOrca = Join-Path $RoamingAppData 'Orca'
$localOrca = Join-Path $LocalAppData 'Orca'
$workspaceRoot = Join-Path $HomeDirectory 'orca'
$programRoot = Join-Path $LocalAppData 'Programs\orca'
$orcaBin = Join-Path $programRoot 'resources\bin'

$findings = [System.Collections.Generic.List[object]]::new()
$provenSkills = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-Finding {
    param(
        [string]$Type,
        [string]$Path,
        [string]$Evidence,
        [string]$RecommendedAction
    )

    $findings.Add([pscustomobject]@{
        Type = $Type
        Path = $Path
        Evidence = $Evidence
        RecommendedAction = $RecommendedAction
    })
}

if (Test-Path -LiteralPath $lockPath) {
    try {
        $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
        if ($null -ne $lock.skills) {
            foreach ($property in @($lock.skills.PSObject.Properties)) {
                $entry = $property.Value
                $source = [string]$entry.source
                $sourceUrl = [string]$entry.sourceUrl
                if ($source -ieq 'stablyai/orca' -or $sourceUrl -match '(?i)github\.com/stablyai/orca') {
                    [void]$provenSkills.Add($property.Name)
                    Add-Finding -Type 'SkillLockEntry' -Path $lockPath -Evidence "$($property.Name) is sourced from stablyai/orca" -RecommendedAction 'Remove only this lock entry'
                }
            }
        }
    }
    catch {
        Add-Finding -Type 'InvalidConfiguration' -Path $lockPath -Evidence $_.Exception.Message -RecommendedAction 'Repair JSON before cleanup'
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
        $signatureMatch = [bool](Select-String -Quiet -LiteralPath $skillFile -Pattern "(?i)stablyai/orca|Orca's computer-use CLI|ORCA skills get|Engage Orca")
    }

    if ($provenSkills.Contains($name) -or $signatureMatch) {
        [void]$provenSkills.Add($name)
        Add-Finding -Type 'SharedSkill' -Path $folder -Evidence 'Orca provenance confirmed by lock file or SKILL.md signature' -RecommendedAction 'Quarantine the folder'
    }
    else {
        Add-Finding -Type 'NameCollision' -Path $folder -Evidence 'Name matches, but Orca provenance was not confirmed' -RecommendedAction 'Review manually; do not remove automatically'
    }
}

if (Test-Path -LiteralPath $claudeSettingsPath) {
    try {
        $settings = Get-Content -Raw -LiteralPath $claudeSettingsPath | ConvertFrom-Json
        $hookMatches = @(Select-String -LiteralPath $claudeSettingsPath -Pattern '(?i)\.orca[\\/]agent-hooks')
        if ($hookMatches.Count -gt 0) {
            Add-Finding -Type 'ClaudeHook' -Path $claudeSettingsPath -Evidence "$($hookMatches.Count) Orca agent-hook reference(s)" -RecommendedAction 'Remove only matching hooks and status line'
        }
    }
    catch {
        Add-Finding -Type 'InvalidConfiguration' -Path $claudeSettingsPath -Evidence $_.Exception.Message -RecommendedAction 'Repair JSON before cleanup'
    }
}

foreach ($candidate in @(
    @{ Type = 'AgentHooks'; Path = $orcaHookRoot; Action = 'Quarantine ~/.orca' },
    @{ Type = 'RoamingAppData'; Path = $roamingOrca; Action = 'Optionally quarantine with -IncludeAppData' },
    @{ Type = 'LocalAppData'; Path = $localOrca; Action = 'Optionally quarantine with -IncludeAppData' },
    @{ Type = 'WorkspaceData'; Path = $workspaceRoot; Action = 'Review carefully; optionally quarantine with -IncludeWorkspaceData' },
    @{ Type = 'ProgramFiles'; Path = $programRoot; Action = 'Uninstall Orca from Windows Settings first' }
)) {
    if (Test-Path -LiteralPath $candidate.Path) {
        Add-Finding -Type $candidate.Type -Path $candidate.Path -Evidence 'Path exists' -RecommendedAction $candidate.Action
    }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
    $matchingPathEntries = @($userPath -split ';' | Where-Object {
        $_ -and $_.Trim().TrimEnd('\') -ieq $orcaBin.TrimEnd('\')
    })
    if ($matchingPathEntries.Count -gt 0) {
        Add-Finding -Type 'UserPath' -Path $orcaBin -Evidence 'Orca resources/bin is in the user PATH' -RecommendedAction 'Remove the exact PATH entry'
    }
}

if ($Json) {
    if ($findings.Count -eq 0) {
        '[]'
    }
    else {
        $findings | ConvertTo-Json -Depth 5
    }
    return
}

if ($findings.Count -eq 0) {
    Write-Host 'No active Orca agent integration residue was found.' -ForegroundColor Green
    return
}

Write-Host "Found $($findings.Count) Orca-related item(s)." -ForegroundColor Yellow
$findings
