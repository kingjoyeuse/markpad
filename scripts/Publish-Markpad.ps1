[CmdletBinding()]
param([ValidateSet('private','public')][string]$Visibility = 'private', [switch]$SourceOnly, [switch]$Release)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repository = 'kingjoyeuse/markpad'
Set-Location -LiteralPath $root
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Nothing was force-pushed or overwritten." }
}
function Probe([string]$Program, [string[]]$Arguments) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $output = & $Program @Arguments 2>$null; return @{Ok=($LASTEXITCODE -eq 0); Text=($output -join "`n")} }
    finally { $ErrorActionPreference = $old }
}
try {
    if ($Release -and $SourceOnly) { throw 'Choose either -Release or -SourceOnly.' }
    foreach ($tool in @('git','gh')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            $id = if ($tool -eq 'git') { 'Git.Git' } else { 'GitHub.cli' }
            throw "$tool is required for publishing only. Install it with: winget install --id $id --exact . Then reopen this publisher."
        }
    }
    $manifest = Get-Content package.json -Raw | ConvertFrom-Json
    $version = $manifest.version; $tag = 'v' + $version
    $releaseDir = Join-Path $root 'dist\releases'
    $assets = @("Markpad-$version-Setup-x64.exe", "Markpad-$version-Portable-x64.zip", 'SHA256SUMS.txt', 'release-manifest.json')
    if ($Release) {
        foreach ($name in $assets) {
            if (-not (Test-Path -LiteralPath (Join-Path $releaseDir $name))) { throw "Missing dist\releases\$name. Extract the complete release project ZIP or run Build-Releases.cmd first." }
        }
        $release = Get-Content -LiteralPath (Join-Path $releaseDir 'release-manifest.json') -Raw | ConvertFrom-Json
        if ($release.version -ne $version) { throw 'The release artifacts are for a different source version. Rebuild them.' }
        foreach ($entry in $release.sourceHashes.PSObject.Properties) {
            $file = Join-Path $root $entry.Name
            if (-not (Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw "Source changed since this release was built: $($entry.Name). Rebuild before publishing." }
        }
        foreach ($line in Get-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt')) {
            if ($line -notmatch '^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$') { throw 'The release checksum list is malformed.' }
            if ((Get-FileHash -LiteralPath (Join-Path $releaseDir $Matches[2]) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1]) { throw 'A release artifact has changed or is incomplete. Download or rebuild it again.' }
        }
    }
    if (-not (Probe 'gh' @('auth','status','--hostname','github.com')).Ok) {
        Run 'gh' @('auth','login','--hostname','github.com','--git-protocol','https','--web','--scopes','repo,workflow')
    }
    $account = (Run 'gh' @('api','user')) | ConvertFrom-Json
    if ($account.login -ne 'kingjoyeuse') { throw "GitHub CLI is signed in as $($account.login), not kingjoyeuse. Use gh auth switch or gh auth login, then try again." }
    Run 'gh' @('auth','setup-git','--hostname','github.com')
    $existing = Probe 'gh' @('repo','view',$repository,'--json','nameWithOwner,isPrivate')
    if ($existing.Ok) {
        $repo = $existing.Text | ConvertFrom-Json
        if (-not $repo.isPrivate -and $Visibility -ne 'public') { throw 'kingjoyeuse/markpad already exists and is public. Run with -Visibility public only when you intend to publish this source publicly.' }
    }
    if (-not (Test-Path -LiteralPath '.git')) { Run 'git' @('init','-b','main') }
    $branch = (Run 'git' @('branch','--show-current')).Trim()
    if ($branch -ne 'main') { throw 'Publish from main. The script will not switch or discard your current branch.' }
    if (-not (Probe 'git' @('config','user.name')).Ok) { Run 'git' @('config','user.name','kingjoyeuse') }
    if (-not (Probe 'git' @('config','user.email')).Ok) { Run 'git' @('config','user.email',"$($account.id)+kingjoyeuse@users.noreply.github.com") }
    $remote = Probe 'git' @('remote','get-url','origin')
    $url = 'https://github.com/kingjoyeuse/markpad.git'
    if ($remote.Ok -and $remote.Text.TrimEnd('/') -notin @($url, $url.Replace('.git',''), 'git@github.com:kingjoyeuse/markpad.git')) { throw 'origin points at another repository. No remote was changed.' }
    $allow = @('.github','assets','desktop','docs','installer','scripts','src','tests','vendor',
               '.gitignore','.gitattributes','package.json','package-lock.json','AGENTS.md','README.md','START-HERE.txt',
               'THIRD_PARTY_NOTICES.md','THIRD_PARTY_LICENSES.txt','Build-Markpad.cmd','Build-Releases.cmd',
               'Publish-Markpad.cmd','Apply-Markpad-Icon.cmd')
    $tracked = @(Run 'git' @('ls-files'))
    foreach ($file in $tracked) {
        $first = ($file -split '/')[0]
        if ($first -notin $allow -or $file -match '(^|/)(node_modules|data|\.env)(/|$)' -or $file -match '\.(exe|dll|zip|log|lnk)$') { throw "Unexpected tracked file: $file. Review it before publishing; the script will not upload runtime binaries, notes, or logs as source." }
    }
    if ($Release -and (Run 'git' @('status','--porcelain'))) { throw 'Commit the reviewed source before publishing release assets.' }
    if (-not (Probe 'git' @('rev-parse','--verify','HEAD')).Ok) { throw 'There is no source commit to publish.' }
    if (-not $existing.Ok) {
        Run 'gh' @('repo','create',$repository,('--' + $Visibility),'--description','Local WYSIWYG Markdown editor with calculator, worksheets, and recoverable drafts')
    }
    if (-not $remote.Ok) { Run 'git' @('remote','add','origin',$url) }
    Run 'git' @('push','-u','origin','main')
    if ($Release) {
        if ((Probe 'gh' @('release','view',$tag,'--repo',$repository)).Ok) { throw "$tag already has a release. It was not overwritten. Increment the version and rebuild for a new release." }
        $head = (Run 'git' @('rev-parse','HEAD')).Trim()
        $existingTag = Probe 'git' @('rev-parse',"$tag^{}")
        if ($existingTag.Ok -and $existingTag.Text.Trim() -ne $head) { throw "$tag points to another commit. No tag was moved." }
        if (-not $existingTag.Ok) { Run 'git' @('tag','-a',$tag,'-m',"Markpad $version") }
        Run 'git' @('push','origin',$tag)
        $files = @($assets | ForEach-Object { Join-Path $releaseDir $_ })
        $notes = Join-Path $root "docs\RELEASE_NOTES_$version.md"
        Run 'gh' (@('release','create',$tag,'--repo',$repository,'--verify-tag','--title',"Markpad $version",'--prerelease','--notes-file',$notes) + $files)
    }
    Write-Host "Published to https://github.com/$repository" -ForegroundColor Green
    if ($Release) { Write-Host "Release: https://github.com/$repository/releases/tag/$tag" }
    Write-Host 'No force-push, visibility change, or published-release replacement was performed.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Any completed GitHub steps remain available. Check the reported error before retrying.'
    exit 1
}
