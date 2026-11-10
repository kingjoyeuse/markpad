# Markpad's per-user setup UI. Embedded in the release EXE; never downloaded at run time.
[CmdletBinding()]
param([string]$BootstrapPath, [string]$PayloadPath, [int]$LauncherPid = 0, [switch]$NoUI)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Version = '@@VERSION@@'
$script:UninstallMode = @@UNINSTALL@@
$script:PayloadHash = '@@PAYLOAD_SHA256@@'
$script:ProductId = 'com.markpad.editor'
$script:RegistryPath = 'Software\Markpad\Installer'
$script:ManifestName = 'markpad-install.json'
$script:Busy = $false
$script:Installed = $false
$script:ExitCode = 0

function Canonical-Path([string]$Path) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))).TrimEnd('\')
}
function Same-Path([string]$First, [string]$Second) {
    if ([string]::IsNullOrWhiteSpace($First) -or [string]::IsNullOrWhiteSpace($Second)) { return $false }
    try { return [string]::Equals((Canonical-Path $First), (Canonical-Path $Second), [StringComparison]::OrdinalIgnoreCase) }
    catch { return $false }
}
function Registry-String([string]$Key, [string]$Name, [string]$Value) {
    $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
    try { $k.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String) } finally { $k.Dispose() }
}
function Read-Registry([string]$Key, [string]$Name) {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Key)
    if ($null -eq $k) { return $null }
    try { return $k.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $k.Dispose() }
}
function Delete-RegistryValue([string]$Key, [string]$Name) {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Key, $true)
    if ($null -ne $k) { try { $k.DeleteValue($Name, $false) } finally { $k.Dispose() } }
}
function Delete-RegistryKey([string]$Key) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($Key, $false) }

function Notify-Shell {
    if (-not ('MarkpadSetup.Native' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace MarkpadSetup {
 public static class Native {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b);
 }
}
'@
    }
    $result = [UIntPtr]::Zero
    [void][MarkpadSetup.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
    [MarkpadSetup.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Set-CommandRegistration([string]$Directory, [bool]$Enabled) {
    # .NET registry APIs avoid NSIS/setx-style PATH length truncation and preserve
    # REG_EXPAND_SZ variables, unrelated entries, ordering, and the original value kind.
    $owned = Read-Registry $script:RegistryPath 'PathAddedByInstaller'
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
        $original = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        if ($key.GetValueNames() -contains 'Path') { $kind = $key.GetValueKind('Path') }
        $parts = @(([string]$original).Split(';'))
        $present = @($parts | Where-Object { Same-Path $_ $Directory }).Count -gt 0
        if ($Enabled) {
            if (-not $present) {
                $separator = if ([string]::IsNullOrEmpty($original) -or $original.EndsWith(';')) { '' } else { ';' }
                $key.SetValue('Path', ([string]$original + $separator + $Directory), $kind)
                Registry-String $script:RegistryPath 'PathAddedByInstaller' $Directory
            }
            Registry-String 'Software\Microsoft\Windows\CurrentVersion\App Paths\Markpad.exe' '' (Join-Path $Directory 'Markpad.exe')
            Registry-String 'Software\Microsoft\Windows\CurrentVersion\App Paths\Markpad.exe' 'Path' $Directory
            Registry-String $script:RegistryPath 'CommandEnabled' '1'
        } else {
            if (Same-Path $owned $Directory) {
                $remaining = @($parts | Where-Object { -not (Same-Path $_ $Directory) })
                $key.SetValue('Path', ($remaining -join ';'), $kind)
                Delete-RegistryValue $script:RegistryPath 'PathAddedByInstaller'
            }
            $appPath = 'Software\Microsoft\Windows\CurrentVersion\App Paths\Markpad.exe'
            if (Same-Path (Read-Registry $appPath '') (Join-Path $Directory 'Markpad.exe')) { Delete-RegistryKey $appPath }
            Registry-String $script:RegistryPath 'CommandEnabled' '0'
        }
    } finally { $key.Dispose() }
    Notify-Shell
}

function Register-Application([string]$Directory, [long]$Bytes) {
    $exe = Join-Path $Directory 'Markpad.exe'
    $open = '"' + $exe + '" "%1"'
    Registry-String 'Software\Classes\Applications\Markpad.exe' 'FriendlyAppName' 'Markpad'
    Registry-String 'Software\Classes\Applications\Markpad.exe\SupportedTypes' '.md' ''
    Registry-String 'Software\Classes\Applications\Markpad.exe\shell\open\command' '' $open
    Registry-String 'Software\Classes\Applications\Markpad.exe\DefaultIcon' '' ('"' + $exe + '",0')
    Registry-String 'Software\Classes\Markpad.Markdown' '' 'Markdown document'
    Registry-String 'Software\Classes\Markpad.Markdown' 'FriendlyTypeName' 'Markdown document'
    Registry-String 'Software\Classes\Markpad.Markdown\DefaultIcon' '' ('"' + $exe + '",0')
    Registry-String 'Software\Classes\Markpad.Markdown\shell\open' 'FriendlyAppName' 'Markpad'
    Registry-String 'Software\Classes\Markpad.Markdown\shell\open\command' '' $open
    Registry-String 'Software\Classes\.md\OpenWithProgids' 'Markpad.Markdown' ''
    Registry-String 'Software\Markpad\Capabilities' 'ApplicationName' 'Markpad'
    Registry-String 'Software\Markpad\Capabilities' 'ApplicationDescription' 'Markdown editor with a calculator and worksheets'
    Registry-String 'Software\Markpad\Capabilities' 'ApplicationIcon' ('"' + $exe + '",0')
    Registry-String 'Software\Markpad\Capabilities\FileAssociations' '.md' 'Markpad.Markdown'
    Registry-String 'Software\RegisteredApplications' 'Markpad' 'Software\Markpad\Capabilities'
    Registry-String $script:RegistryPath 'InstallLocation' $Directory
    Registry-String $script:RegistryPath 'Version' $script:Version
    $uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\Markpad'
    Registry-String $uninstallKey 'DisplayName' 'Markpad'
    Registry-String $uninstallKey 'DisplayVersion' $script:Version
    Registry-String $uninstallKey 'Publisher' 'kingjoyeuse'
    Registry-String $uninstallKey 'DisplayIcon' ('"' + $exe + '",0')
    Registry-String $uninstallKey 'InstallLocation' $Directory
    Registry-String $uninstallKey 'UninstallString' ('"' + (Join-Path $Directory 'Uninstall Markpad.exe') + '"')
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($uninstallKey)
    try {
        $key.SetValue('NoModify', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
        $key.SetValue('NoRepair', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
        $key.SetValue('EstimatedSize', [int][Math]::Ceiling($Bytes / 1024), [Microsoft.Win32.RegistryValueKind]::DWord)
    } finally { $key.Dispose() }
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Markpad.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($menu)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $Directory
    $shortcut.Description = 'Markpad Markdown editor'
    $shortcut.IconLocation = $exe + ',0'
    $shortcut.Save()
    # This only advertises support. Never write .md's default or UserChoice.
    Notify-Shell
}

function Unregister-Application([string]$Directory) {
    $exe = Join-Path $Directory 'Markpad.exe'
    $open = '"' + $exe + '" "%1"'
    $owned = Same-Path (Read-Registry $script:RegistryPath 'InstallLocation') $Directory
    if (-not $owned) { return }
    Set-CommandRegistration $Directory $false
    if ((Read-Registry 'Software\Classes\Applications\Markpad.exe\shell\open\command' '') -eq $open) {
        Delete-RegistryKey 'Software\Classes\Applications\Markpad.exe'
    }
    if ((Read-Registry 'Software\Classes\Markpad.Markdown\shell\open\command' '') -eq $open) {
        Delete-RegistryKey 'Software\Classes\Markpad.Markdown'
        Delete-RegistryValue 'Software\Classes\.md\OpenWithProgids' 'Markpad.Markdown'
        Delete-RegistryValue 'Software\RegisteredApplications' 'Markpad'
        Delete-RegistryKey 'Software\Markpad\Capabilities'
    }
    Delete-RegistryKey 'Software\Microsoft\Windows\CurrentVersion\Uninstall\Markpad'
    Delete-RegistryKey $script:RegistryPath
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Markpad.lnk'
    if (Test-Path -LiteralPath $shortcut) {
        $shell = New-Object -ComObject WScript.Shell
        if (Same-Path ($shell.CreateShortcut($shortcut).TargetPath) $exe) { Remove-Item -LiteralPath $shortcut -Force }
    }
    Notify-Shell
}

function Owned-Manifest([string]$Directory) {
    $file = Join-Path $Directory $script:ManifestName
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'This is not a Markpad installer-managed folder.' }
    $manifest = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.productId -ne $script:ProductId -or $manifest.format -ne 1) { throw 'The installation manifest is not recognized.' }
    foreach ($item in $manifest.files) { [void](Child-Path $Directory $item.path) }
    return $manifest
}
function Child-Path([string]$Directory, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative.Contains(':')) { throw 'Unsafe file path in package manifest.' }
    $root = (Canonical-Path $Directory) + '\'
    $result = [IO.Path]::GetFullPath((Join-Path $Directory $Relative))
    if (-not $result.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path is outside the installation folder.' }
    # Never traverse a user-added junction or symlink during install/uninstall.
    $parent = [IO.Path]::GetDirectoryName($result)
    while ($parent -and $parent.Length -ge $Directory.Length) {
        if (Test-Path -LiteralPath $parent) {
            if (((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation paths must not contain symbolic links or junctions.' }
        }
        $parent = [IO.Path]::GetDirectoryName($parent)
    }
    return $result
}
function Ensure-Closed([string]$Directory) {
    $exe = Join-Path $Directory 'Markpad.exe'
    foreach ($process in @(Get-Process -Name Markpad -ErrorAction SilentlyContinue)) {
        $file = $null
        try { $file = $process.MainModule.FileName } catch { }
        if ($null -eq $file -or (Same-Path $file $exe)) { throw 'Close all installed Markpad windows, then try again. Unsaved drafts will be preserved.' }
    }
}
function Update-Progress([string]$Text, [int]$Value = -1) {
    if ($NoUI) { return }
    $script:Status.Text = $Text
    if ($Value -ge 0) { $script:Progress.Value = [Math]::Min(100, [Math]::Max(0, $Value)) }
    [System.Windows.Forms.Application]::DoEvents()
}
function Install-Markpad([string]$Directory, [string]$Payload) {
    $Directory = Canonical-Path $Directory
    $volume = [IO.Path]::GetPathRoot($Directory).TrimEnd('\')
    if ($Directory.Length -le $volume.Length + 1) { throw 'Choose an application subfolder, not the root of a drive.' }
    if (Test-Path -LiteralPath (Join-Path $Directory 'markpad-portable.json')) { throw 'Choose a separate folder for the installed app. This folder is a portable copy.' }
    if (Test-Path -LiteralPath (Join-Path $Directory 'AGENTS.md')) { throw 'Do not install into your source project. Choose an application folder instead.' }
    Ensure-Closed $Directory
    $registered = Read-Registry $script:RegistryPath 'InstallLocation'
    if ($registered -and -not (Same-Path $registered $Directory) -and (Test-Path -LiteralPath (Join-Path $registered $script:ManifestName))) {
        throw "Markpad is already installed in $registered. Use that folder to upgrade it, or uninstall that copy first."
    }
    $previous = $null
    if (Test-Path -LiteralPath $Directory) {
        if (@(Get-ChildItem -LiteralPath $Directory -Force).Count) { $previous = Owned-Manifest $Directory }
        [void](Child-Path $Directory 'Markpad.exe')
    }
    Update-Progress 'Checking the installer package...' 1
    if ((Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $script:PayloadHash) { throw 'The embedded package checksum does not match. Download the installer again.' }
    $parent = [IO.Path]::GetDirectoryName($Directory)
    [void][IO.Directory]::CreateDirectory($parent)
    $stage = Join-Path $parent ('.markpad-stage-' + [Guid]::NewGuid().ToString('N'))
    $backup = Join-Path $parent ('.markpad-backup-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    $swapped = $false; $backedUp = $false
    try {
        if ($null -ne $previous) {
            # Preserve user-added documents; only remove known files from our old
            # manifest in the staging copy, never from the original installation.
            Update-Progress 'Preserving existing files...' 3
            foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force -Recurse) {
                if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Remove junctions/symlinks from the application folder before upgrading.' }
            }
            foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) { Copy-Item -LiteralPath $entry.FullName -Destination $stage -Recurse -Force }
            foreach ($item in $previous.files) {
                $old = Child-Path $stage $item.path
                if (Test-Path -LiteralPath $old -PathType Leaf) { Remove-Item -LiteralPath $old -Force }
            }
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($Payload)
        try {
            $index = 0
            foreach ($entry in $zip.Entries) {
                if ($entry.FullName.EndsWith('/')) { continue }
                $destination = Child-Path $stage $entry.FullName
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
                $index++
                Update-Progress 'Installing application files...' (5 + [int](65 * $index / $zip.Entries.Count))
            }
        } finally { $zip.Dispose() }
        $manifest = Owned-Manifest $stage
        $index = 0; $bytes = 0L
        foreach ($item in $manifest.files) {
            $file = Child-Path $stage $item.path
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw ('A packaged file failed verification: ' + $item.path) }
            $bytes += (Get-Item -LiteralPath $file).Length
            $index++; Update-Progress 'Verifying installed files...' (70 + [int](25 * $index / $manifest.files.Count))
        }
        if (Test-Path -LiteralPath $Directory) { Move-Item -LiteralPath $Directory -Destination $backup; $backedUp = $true }
        Move-Item -LiteralPath $stage -Destination $Directory; $swapped = $true
        Register-Application $Directory $bytes
        if ($backedUp) {
            try { Remove-Item -LiteralPath $backup -Recurse -Force }
            catch { Write-Warning "The upgrade succeeded; an old backup remains at $backup." }
        }
        Update-Progress 'Installation complete.' 100
    } catch {
        $failure = $_
        if ($swapped -and (Test-Path -LiteralPath $Directory)) { Remove-Item -LiteralPath $Directory -Recurse -Force }
        if ($backedUp -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $Directory }
        if (-not $backedUp) { try { Unregister-Application $Directory } catch { } }
        throw $failure
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}

function Uninstall-Markpad([string]$Directory) {
    $Directory = Canonical-Path $Directory
    $manifest = Owned-Manifest $Directory
    Ensure-Closed $Directory
    Unregister-Application $Directory
    $self = Join-Path $Directory 'Uninstall Markpad.exe'
    foreach ($item in $manifest.files) {
        $file = Child-Path $Directory $item.path
        if (Same-Path $file $self) { continue }
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath (Join-Path $Directory $script:ManifestName) -Force
    # Remove only empty directories, leaving any user-added documents intact.
    foreach ($folder in @(Get-ChildItem -LiteralPath $Directory -Directory -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending)) {
        if (-not @(Get-ChildItem -LiteralPath $folder.FullName -Force).Count) { Remove-Item -LiteralPath $folder.FullName -Force }
    }
    # The native launcher is still mapped until this UI exits. A narrowly scoped
    # cleanup child waits for that launcher only and removes that one executable.
    $quotedSelf = $self.Replace("'", "''")
    $quotedDirectory = $Directory.Replace("'", "''")
    $wait = if ($LauncherPid -gt 0) { "Wait-Process -Id $LauncherPid -Timeout 120 -ErrorAction SilentlyContinue; " } else { 'Start-Sleep -Seconds 2; ' }
    $cleanup = $wait + "Remove-Item -LiteralPath '$quotedSelf' -Force -ErrorAction SilentlyContinue; if ((Test-Path -LiteralPath '$quotedDirectory') -and -not @(Get-ChildItem -LiteralPath '$quotedDirectory' -Force).Count) { Remove-Item -LiteralPath '$quotedDirectory' -Force }"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanup))
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded) -WindowStyle Hidden
}
function Open-DefaultApps {
    $build = [int](Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name CurrentBuildNumber)
    $uri = if ($build -ge 22000) { 'ms-settings:defaultapps?registeredAppUser=Markpad' } else { 'ms-settings:defaultapps' }
    if ($build -lt 22000 -and -not $NoUI) {
        [void][System.Windows.Forms.MessageBox]::Show('In Windows Settings, choose defaults by app and select Markpad, or choose defaults by file type and select Markpad for .md. Windows requires you to confirm this choice.', 'Choose Markpad for Markdown', 'OK', 'Information')
    }
    Start-Process $uri
}
if ($NoUI) { return }

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = if ($script:UninstallMode) { 'Uninstall Markpad' } else { 'Markpad Setup' }
    $form.ClientSize = New-Object System.Drawing.Size(570, 360)
    $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.StartPosition = 'CenterScreen'; $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $form.AutoScaleMode = 'Dpi'
    try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($BootstrapPath) } catch { }
    function Label-At([string]$Text, [int]$Y, [int]$Height = 35) {
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $Text; $label.Location = New-Object System.Drawing.Point(25, $Y); $label.Size = New-Object System.Drawing.Size(520, $Height)
        $form.Controls.Add($label); return $label
    }
    $heading = Label-At $(if ($script:UninstallMode) { 'Remove Markpad' } else { 'Install Markpad' }) 22 35
    $heading.Font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
    $intro = Label-At $(if ($script:UninstallMode) { 'Application files will be removed. Your Markdown files, settings, and recoverable drafts will be kept.' } else { 'A local Markdown editor with a calculator and worksheets. Installs for your Windows account without administrator privileges.' }) 65 50
    $destinationLabel = Label-At 'Install location' 125 22
    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(25, 151); $box.Size = New-Object System.Drawing.Size(425, 25)
    $previous = Read-Registry $script:RegistryPath 'InstallLocation'
    $box.Text = if ($script:UninstallMode) { Split-Path -Parent $BootstrapPath } elseif ($previous) { $previous } else { Join-Path $env:LOCALAPPDATA 'Programs\Markpad' }
    $form.Controls.Add($box)
    $browse = New-Object System.Windows.Forms.Button
    $browse.Text = 'Browse...'; $browse.Location = New-Object System.Drawing.Point(460, 149); $browse.Size = New-Object System.Drawing.Size(85, 27)
    $browse.Add_Click({
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Choose a Markpad application folder, not your source project.'
        $dialog.SelectedPath = $box.Text
        if ($dialog.ShowDialog($form) -eq 'OK') { $box.Text = $dialog.SelectedPath }
        $dialog.Dispose()
    }); $form.Controls.Add($browse)
    if ($script:UninstallMode) { $destinationLabel.Text = 'Application location'; $box.ReadOnly = $true; $browse.Visible = $false }
    $script:Status = Label-At '' 200 42
    $script:Progress = New-Object System.Windows.Forms.ProgressBar
    $script:Progress.Location = New-Object System.Drawing.Point(25, 246); $script:Progress.Size = New-Object System.Drawing.Size(520, 16)
    $form.Controls.Add($script:Progress)
    $pathCheck = New-Object System.Windows.Forms.CheckBox
    $pathCheck.Text = 'Add Markpad to my PATH (Run and terminals: markpad)'
    $pathCheck.Location = New-Object System.Drawing.Point(25, 125); $pathCheck.Size = New-Object System.Drawing.Size(520, 28); $pathCheck.Visible = $false
    $defaultCheck = New-Object System.Windows.Forms.CheckBox
    $defaultCheck.Text = 'Use Markpad for .md files (Windows asks you to confirm)'
    $defaultCheck.Location = New-Object System.Drawing.Point(25, 161); $defaultCheck.Size = New-Object System.Drawing.Size(520, 28); $defaultCheck.Visible = $false
    $runCheck = New-Object System.Windows.Forms.CheckBox
    $runCheck.Text = 'Launch Markpad'; $runCheck.Checked = $true
    $runCheck.Location = New-Object System.Drawing.Point(25, 197); $runCheck.Size = New-Object System.Drawing.Size(520, 28); $runCheck.Visible = $false
    $form.Controls.AddRange(@($pathCheck, $defaultCheck, $runCheck))
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'; $cancel.Location = New-Object System.Drawing.Point(345, 300); $cancel.Size = New-Object System.Drawing.Size(95, 32)
    $cancel.Add_Click({ $form.Close() }); $form.Controls.Add($cancel)
    $action = New-Object System.Windows.Forms.Button
    $action.Text = if ($script:UninstallMode) { 'Uninstall' } else { 'Install' }
    $action.Location = New-Object System.Drawing.Point(450, 300); $action.Size = New-Object System.Drawing.Size(95, 32)
    $form.Controls.Add($action); $form.AcceptButton = $action; $form.CancelButton = $cancel
    $form.Add_FormClosing({ param($sender, $event) if ($script:Busy) { $event.Cancel = $true } })
    $action.Add_Click({
        if ($script:Installed) {
            try {
                Set-CommandRegistration $box.Text $pathCheck.Checked
                if ($runCheck.Checked) { Start-Process -FilePath (Join-Path $box.Text 'Markpad.exe') -WorkingDirectory $box.Text }
                if ($defaultCheck.Checked) { Open-DefaultApps }
                $form.Close()
            } catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Markpad setup options', 'OK', 'Warning') }
            return
        }
        $script:Busy = $true; $action.Enabled = $false; $cancel.Enabled = $false; $box.Enabled = $false; $browse.Enabled = $false
        try {
            if ($script:UninstallMode) {
                Update-Progress 'Removing application files...' 10
                Uninstall-Markpad $box.Text
                [void][System.Windows.Forms.MessageBox]::Show('Markpad was removed. Your documents and recovery drafts were kept.', 'Markpad', 'OK', 'Information')
                $script:Busy = $false; $form.Close()
            } else {
                $box.Text = Canonical-Path $box.Text
                Install-Markpad $box.Text $PayloadPath
                $script:ExitCode = 0; $script:Installed = $true; $heading.Text = 'Markpad is installed'
                $intro.Text = 'Choose any optional integrations, then click Finish. Both integrations are optional and apply only to your Windows account.'
                $destinationLabel.Visible = $false; $box.Visible = $false; $browse.Visible = $false
                $script:Status.Visible = $false; $script:Progress.Visible = $false; $cancel.Visible = $false
                $pathCheck.Checked = (Read-Registry $script:RegistryPath 'CommandEnabled') -eq '1'
                $pathCheck.Visible = $true; $defaultCheck.Visible = $true; $runCheck.Visible = $true
                $action.Text = 'Finish'; $action.Enabled = $true
            }
        } catch {
            $script:ExitCode = 1
            [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Markpad Setup', 'OK', 'Error')
            $action.Enabled = $true; $cancel.Enabled = $true; $box.Enabled = $true; $browse.Enabled = $true
            $script:Status.Text = 'No installation was completed. Correct the issue and try again.'
        } finally { $script:Busy = $false }
    })
    [void]$form.ShowDialog(); $form.Dispose()
    exit $script:ExitCode
} catch {
    try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Markpad Setup could not start', 'OK', 'Error') } catch { }
    exit 1
}
