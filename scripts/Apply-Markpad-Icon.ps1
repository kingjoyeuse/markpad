# Windows-only, offline Markpad branding / portable runtime layout updater.
# Native Win32 resource APIs are used so there is no dependency on rcedit, Wine,
# a third-party icon editor, Visual Studio, or an internet download.
[CmdletBinding()]
param(
    [string]$Exe = '',
    [switch]$IconOnly
)
$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$icon = Join-Path $project 'assets\markpad.ico'
$windowIcon = Join-Path $project 'assets\markpad.png'
$sourceMain = Join-Path $project 'desktop\main.cjs'
if (!(Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Missing application icon: $icon" }
if (!$IconOnly -and !(Test-Path -LiteralPath $windowIcon -PathType Leaf)) { throw "Missing window icon: $windowIcon" }

if ($Exe) {
    $exePath = [System.IO.Path]::GetFullPath($Exe)
} else {
    $binExe = Join-Path $project 'bin\Markpad.exe'
    $rootExe = Join-Path $project 'Markpad.exe'
    if (Test-Path -LiteralPath $binExe -PathType Leaf) {
        $exePath = $binExe
    } elseif (Test-Path -LiteralPath $rootExe -PathType Leaf) {
        $exePath = $rootExe
    } else {
        throw "Couldn't find bin\Markpad.exe or Markpad.exe. Keep the executable in your project folder's bin directory."
    }
}
if (!(Test-Path -LiteralPath $exePath -PathType Leaf)) { throw "Executable not found: $exePath" }
$runtime = Split-Path -Path $exePath -Parent

# A running Electron process locks its EXE on Windows; do not touch active
# windows or their unsaved drafts. This check is for user-applied patches only.
if (!$IconOnly -and (Get-Process -Name 'Markpad' -ErrorAction SilentlyContinue)) {
    throw 'Close ALL Markpad windows before applying the new icon. Your drafts remain in recovery.'
}

# If the user moved JUST Markpad.exe into bin/, migrate only the runtime files.
# Never move source, Git data, Markdown notes, project docs, or user shortcuts.
function Move-RuntimePart([string]$from, [string]$to) {
    if (!(Test-Path -LiteralPath $from)) { return }
    if (!(Test-Path -LiteralPath $to)) {
        Move-Item -LiteralPath $from -Destination $to -ErrorAction Stop
        return
    }
    $sourceItem = Get-Item -LiteralPath $from
    $targetItem = Get-Item -LiteralPath $to
    if ($sourceItem.PSIsContainer -and $targetItem.PSIsContainer) {
        foreach ($child in @(Get-ChildItem -LiteralPath $from -Force)) {
            Move-RuntimePart $child.FullName (Join-Path $to $child.Name)
        }
        $childCount = @(Get-ChildItem -LiteralPath $from -Force).Count
        if ($childCount -eq 0) {
            Remove-Item -LiteralPath $from -Force
        }
    }
    # If the destination already exists, preserve its content. In particular,
    # never overwrite a newer runtime with a stale duplicate from the root.
}

if (!$IconOnly) {
    $rootExeDir = [System.IO.Path]::GetFullPath($project).TrimEnd('\')
    $exeDir = [System.IO.Path]::GetFullPath($runtime).TrimEnd('\')
    if (-not [string]::Equals($rootExeDir, $exeDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        $runtimeNames = @(
            'chrome_100_percent.pak', 'chrome_200_percent.pak',
            'd3dcompiler_47.dll', 'dxcompiler.dll', 'electron_wer.dll',
            'ffmpeg.dll', 'icudtl.dat', 'locales', 'resources',
            'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
            'version', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json',
            'vulkan-1.dll', 'LICENSES.chromium.html'
        )
        foreach ($name in $runtimeNames) {
            Move-RuntimePart (Join-Path $project $name) (Join-Path $runtime $name)
        }
    }
    if (!(Test-Path -LiteralPath (Join-Path $runtime 'resources\app\package.json'))) {
        throw "The Electron support files were not found beside the EXE. Ensure the resources\app directory is under $runtime."
    }
    if (!(Test-Path -LiteralPath (Join-Path $runtime 'icudtl.dat'))) {
        throw "The Electron runtime file icudtl.dat was not found beside the EXE under $runtime."
    }
    if (!(Test-Path -LiteralPath $sourceMain -PathType Leaf)) {
        throw "Missing source file: $sourceMain"
    }
    $runtimeAssets = Join-Path $runtime 'resources\app\assets'
    New-Item -ItemType Directory -Path $runtimeAssets -Force | Out-Null
    Copy-Item -LiteralPath $windowIcon -Destination (Join-Path $runtimeAssets 'markpad.png') -Force
    Copy-Item -LiteralPath $icon -Destination (Join-Path $runtimeAssets 'markpad.ico') -Force
    Copy-Item -LiteralPath $sourceMain -Destination (Join-Path $runtime 'resources\app\desktop\main.cjs') -Force
    Write-Host 'Updated the native window/taskbar icon and synchronized the branded window code.'
}

$resourceWriter = @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class MarkpadWindowsIconResource {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);

    public static void NotifyIconChanged(string path) {
        IntPtr item = Marshal.StringToHGlobalUni(path);
        try { SHChangeNotify(0x00002000, 0x3005, item, IntPtr.Zero); }
        finally { Marshal.FreeHGlobal(item); }
    }
    public static void NotifyAssociationsChanged() {
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }

    [DllImport("kernel32.dll", EntryPoint = "BeginUpdateResourceW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string filename, [MarshalAs(UnmanagedType.Bool)] bool deleteExisting);

    [DllImport("kernel32.dll", EntryPoint = "UpdateResourceW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name,
        ushort language, byte[] data, uint byteCount);

    [DllImport("kernel32.dll", EntryPoint = "EndUpdateResourceW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndUpdateResource(IntPtr update, [MarshalAs(UnmanagedType.Bool)] bool discard);

    private static void ThrowLastError(string operation) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static void Align(BinaryWriter writer) {
        while ((writer.BaseStream.Position & 3) != 0) writer.Write((byte)0);
    }

    private static void Block(BinaryWriter writer, string key, ushort valueLength,
        ushort type, Action value, Action children) {
        long start = writer.BaseStream.Position;
        writer.Write((ushort)0); writer.Write(valueLength); writer.Write(type);
        writer.Write(Encoding.Unicode.GetBytes(key + "\0"));
        Align(writer);
        if (value != null) value();
        Align(writer);
        if (children != null) children();
        long end = writer.BaseStream.Position;
        if (end - start > UInt16.MaxValue) throw new InvalidDataException("Version resource too large");
        writer.BaseStream.Position = start;
        writer.Write((ushort)(end - start));
        writer.BaseStream.Position = end;
    }

    private static void WriteString(BinaryWriter writer, string key, string value) {
        Block(writer, key, (ushort)(value.Length + 1), 1,
            () => writer.Write(Encoding.Unicode.GetBytes(value + "\0")), null);
    }

    private static byte[] MarkpadVersionInfo() {
        using (var stream = new MemoryStream())
        using (var writer = new BinaryWriter(stream)) {
            Block(writer, "VS_VERSION_INFO", 52, 0, () => {
                // VS_FIXEDFILEINFO. The rest of this VERSIONINFO is a standard
                // English-US Unicode StringFileInfo plus Translation block.
                uint[] fixedInfo = {
                    0xFEEF04BD, 0x00010000, 0x00000001, 0x00040000,
                    0x00000001, 0x00040000, 0x0000003F, 0x00000000,
                    0x00040004, 0x00000001, 0x00000000, 0x00000000, 0x00000000
                };
                foreach (uint item in fixedInfo) writer.Write(item);
            }, () => {
                Block(writer, "StringFileInfo", 0, 1, null, () => {
                    Block(writer, "040904B0", 0, 1, null, () => {
                        WriteString(writer, "CompanyName", "Markpad");
                        WriteString(writer, "FileDescription", "Markpad Markdown Editor");
                        WriteString(writer, "FileVersion", "0.1.4.0");
                        WriteString(writer, "InternalName", "Markpad");
                        WriteString(writer, "OriginalFilename", "Markpad.exe");
                        WriteString(writer, "ProductName", "Markpad");
                        WriteString(writer, "ProductVersion", "0.1.4.0");
                    });
                });
                Block(writer, "VarFileInfo", 0, 1, null, () => {
                    Block(writer, "Translation", 4, 0, () => {
                        writer.Write((ushort)0x0409); writer.Write((ushort)0x04B0);
                    }, null);
                });
            });
            return stream.ToArray();
        }
    }

    public static void Embed(string exe, string iconPath) {
        byte[] ico = File.ReadAllBytes(iconPath);
        if (ico.Length < 22 || BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) {
            throw new InvalidDataException("Invalid .ico header");
        }
        int count = BitConverter.ToUInt16(ico, 4);
        if (count < 1 || count > 100 || ico.Length < 6 + 16 * count) {
            throw new InvalidDataException("Invalid .ico image count");
        }
        byte[] group = new byte[6 + 14 * count];
        Array.Copy(ico, 0, group, 0, 6);
        byte[][] images = new byte[count][];
        for (int i = 0; i < count; ++i) {
            int entry = 6 + 16 * i;
            uint length = BitConverter.ToUInt32(ico, entry + 8);
            uint offset = BitConverter.ToUInt32(ico, entry + 12);
            if (length == 0 || (ulong)offset > (ulong)ico.Length || (ulong)length > ((ulong)ico.Length - (ulong)offset)) {
                throw new InvalidDataException("Invalid .ico image offset or size");
            }
            images[i] = new byte[(int)length];
            Array.Copy(ico, (int)offset, images[i], 0, (int)length);
            // A GRPICONDIR entry copies 12 bytes from the ICO entry and
            // replaces its four-byte data offset with a two-byte RT_ICON ID.
            Array.Copy(ico, entry, group, 6 + 14 * i, 12);
            Array.Copy(BitConverter.GetBytes((ushort)(i + 1)), 0, group, 6 + 14 * i + 12, 2);
        }
        // Electron 45's bundled executable uses group 1, language 1033.
        // Replacing that group makes Explorer display Markpad instead of Electron.
        IntPtr update = BeginUpdateResource(exe, false);
        if (update == IntPtr.Zero) ThrowLastError("BeginUpdateResource");
        bool committed = false;
        try {
            for (int i = 0; i < count; ++i) {
                if (!UpdateResource(update, (IntPtr)3, (IntPtr)(i + 1), 1033,
                    images[i], (uint)images[i].Length)) {
                    ThrowLastError("UpdateResource RT_ICON");
                }
            }
            if (!UpdateResource(update, (IntPtr)14, (IntPtr)1, 1033,
                group, (uint)group.Length)) {
                ThrowLastError("UpdateResource RT_GROUP_ICON");
            }
            byte[] versionInfo = MarkpadVersionInfo();
            if (!UpdateResource(update, (IntPtr)16, (IntPtr)1, 1033,
                versionInfo, (uint)versionInfo.Length)) {
                ThrowLastError("UpdateResource RT_VERSION");
            }
            if (!EndUpdateResource(update, false)) ThrowLastError("EndUpdateResource");
            committed = true;
        } finally {
            if (!committed) EndUpdateResource(update, true);
        }
    }
}
'@
Add-Type -TypeDefinition $resourceWriter -Language CSharp -ErrorAction Stop

# Stage a copy, update only that copy, then atomically replace the executable.
# A failed UpdateResource must never leave a partially written Markpad.exe.
$stage = Join-Path $runtime ('Markpad.icon-stage-' + [guid]::NewGuid().ToString('N') + '.exe')
$backup = Join-Path $runtime ('Markpad.before-icon-' + [guid]::NewGuid().ToString('N') + '.bak')
try {
    Copy-Item -LiteralPath $exePath -Destination $stage -ErrorAction Stop
    [MarkpadWindowsIconResource]::Embed($stage, $icon)
    [System.IO.File]::Replace($stage, $exePath, $backup)
    [MarkpadWindowsIconResource]::NotifyIconChanged($exePath)
    [MarkpadWindowsIconResource]::NotifyIconChanged($icon)
    Write-Host "Embedded Markpad's icon and application-name metadata in $exePath"
    if (Test-Path -LiteralPath $backup) {
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
} finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue
    }
}

if (!$IconOnly) {
    try {
        # This is an optional per-user Open With label. It does not set a
        # default program or change a user's existing file associations.
        $application = 'HKCU:\Software\Classes\Applications\Markpad.exe'
        New-Item -Path $application -Force | Out-Null
        New-ItemProperty -Path $application -Name 'FriendlyAppName' -Value 'Markpad' -PropertyType String -Force | Out-Null
        $defaultIcon = Join-Path $application 'DefaultIcon'
        New-Item -Path $defaultIcon -Force | Out-Null
        Set-Item -Path $defaultIcon -Value ('"' + $icon + '",0')
        $openCommand = Join-Path $application 'shell\open\command'
        New-Item -Path $openCommand -Force | Out-Null
        Set-Item -Path $openCommand -Value ('"' + $exePath + '" "%1"')
        [MarkpadWindowsIconResource]::NotifyAssociationsChanged()
        Write-Host 'Registered the Markpad display name and icon in the current user Open With list.'
    } catch {
        Write-Warning "The EXE metadata was updated, but optional Open With registration could not complete: $($_.Exception.Message)"
    }
    try {
        $shell = New-Object -ComObject WScript.Shell
        $count = 0
        foreach ($item in @(Get-ChildItem -LiteralPath $project -Filter '*.lnk' -File)) {
            $shortcut = $shell.CreateShortcut($item.FullName)
            if (!$shortcut.TargetPath) { continue }
            try { $target = [System.IO.Path]::GetFullPath($shortcut.TargetPath) }
            catch { continue }
            if ([string]::Equals($target, $exePath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $shortcut.IconLocation = "$icon,0"
                $shortcut.WorkingDirectory = $runtime
                $shortcut.Save()
                [MarkpadWindowsIconResource]::NotifyIconChanged($item.FullName)
                $count++
            }
        }
        Write-Host "Updated $count existing Markpad shortcut(s) in the project root."
        if ($count -eq 0) {
            Write-Host 'No matching .lnk shortcuts found. Existing shortcuts can keep pointing to bin\Markpad.exe; choose assets\markpad.ico as their icon if needed.'
        }
    } catch {
        Write-Warning "The EXE icon was updated, but shortcut customization could not be completed: $($_.Exception.Message)"
    }
    Write-Host 'Completed. Launch your existing Markpad shortcut to open a window with the new icon.'
    Write-Host 'If Windows still caches the old taskbar icon, unpin and repin the shortcut.'
}
