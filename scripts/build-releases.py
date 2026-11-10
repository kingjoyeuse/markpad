#!/usr/bin/env python3
"""Build runtime-only Windows x64 portable ZIP and per-user installer EXE.

Python 3.10+, Node, clang and lld-link are development-only requirements.
Use an existing Windows runtime with --runtime bin, or run npm run package:win
and pass --runtime dist/Markpad-win32-x64. No downloads happen in this script.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('windows_resources', ROOT / 'scripts/windows-resources.py')
res = importlib.util.module_from_spec(spec)
spec.loader.exec_module(res)
RUNTIME_FILES = [
    'Markpad.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
    'd3dcompiler_47.dll', 'dxcompiler.dll', 'electron_wer.dll', 'ffmpeg.dll',
    'icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
    'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll',
    'LICENSE', 'LICENSES.chromium.html', 'version', 'locales/en-US.pak',
]
FOOTER_MAGIC = b'MARKPADSETUPv1\0\0'
assert len(FOOTER_MAGIC) == 16


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def tool(name):
    found = shutil.which(name)
    if not found and os.name == 'nt':
        candidate = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'LLVM/bin' / (name + '.exe')
        if candidate.is_file():
            found = str(candidate)
    if not found:
        raise RuntimeError(f'{name} was not found. Install LLVM (clang and lld-link) for release builds only.')
    return found


def run(command):
    subprocess.run([str(item) for item in command], cwd=ROOT, check=True)


def zip_tree(directory, destination):
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for file in sorted(directory.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(directory).as_posix())


def install_zip_from_portable(portable_zip, directory, destination):
    """Reuse unchanged ZIP members without recompressing the runtime."""
    changed = {'markpad-portable.json', 'README.txt'}
    with zipfile.ZipFile(portable_zip, 'r') as source, zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        with open(portable_zip, 'rb') as raw:
            for entry in source.infolist():
                if entry.filename in changed:
                    continue
                if entry.flag_bits & 8:
                    raise ValueError('Unexpected ZIP data descriptor')
                raw.seek(entry.header_offset)
                header = raw.read(30)
                if header[:4] != b'PK\x03\x04':
                    raise ValueError('Invalid ZIP local record')
                name_length, extra_length = struct.unpack_from('<HH', header, 26)
                clone = copy.copy(entry)
                clone.header_offset = target.fp.tell()
                target.fp.write(header)
                remaining = name_length + extra_length + entry.compress_size
                while remaining:
                    block = raw.read(min(1024 * 1024, remaining))
                    if not block:
                        raise ValueError('Truncated portable ZIP')
                    target.fp.write(block); remaining -= len(block)
                target.filelist.append(clone)
                target.NameToInfo[clone.filename] = clone
            target.start_dir = target.fp.tell()
            target._didModify = True
        for name in ('README.txt', 'Uninstall Markpad.exe', 'markpad-install.json'):
            target.write(directory / name, name)


def bootstrap(build, version, uninstall=False):
    name = 'Uninstall Markpad.exe' if uninstall else f'Markpad-{version}-Setup-x64.exe'
    description = 'Markpad Uninstaller' if uninstall else 'Markpad Setup'
    resource_file = build / ('uninstall.res' if uninstall else 'setup.res')
    tree = res.branding(ROOT / 'assets/markpad.ico', version, description, name)
    tree[24] = {1: {1033: ((ROOT / 'installer/manifest.xml').read_bytes(), 0)}}
    res.write_res(resource_file, tree)
    exe = build / name
    run([tool('lld-link'), '/entry:mainCRTStartup', '/subsystem:windows,6.02', '/machine:x64',
         '/nodefaultlib', '/dynamicbase', '/nxcompat', '/opt:ref', '/opt:icf', '/timestamp:0',
         '/manifest:no', f'/out:{exe}', build / 'bootstrap.obj', resource_file,
         build / 'kernel32.lib', build / 'user32.lib', build / 'bcrypt.lib'])
    return exe


def append_payload(exe, version, uninstall=False, payload=None):
    script = (ROOT / 'installer/setup.ps1').read_text(encoding='utf-8')
    script = script.replace('@@VERSION@@', version).replace('@@UNINSTALL@@', '$true' if uninstall else '$false')
    script = script.replace('@@PAYLOAD_SHA256@@', sha(payload) if payload else '')
    # UTF-8 BOM makes Unicode readable by Windows PowerShell 5.1.
    encoded = b'\xef\xbb\xbf' + script.replace('\n', '\r\n').encode('utf-8')
    payload_size = payload.stat().st_size if payload else 0
    with exe.open('ab') as stream:
        stream.write(encoded)
        if payload:
            with payload.open('rb') as source:
                shutil.copyfileobj(source, stream)
        stream.write(FOOTER_MAGIC + struct.pack('<QQ', len(encoded), payload_size))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=ROOT / 'bin')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/releases')
    args = parser.parse_args()
    os.chdir(ROOT)
    runtime = args.runtime.resolve()
    output = args.output.resolve()
    manifest = json.loads((ROOT / 'package.json').read_text())
    version = manifest['version']
    runtime_version = (runtime / 'version').read_text().strip().lstrip('v')
    expected_version = manifest['devDependencies']['electron']
    if runtime_version != expected_version:
        raise RuntimeError(f'Runtime Electron {runtime_version} does not match pinned Electron {expected_version}.')
    for filename in RUNTIME_FILES:
        if not (runtime / filename).is_file():
            raise RuntimeError(f'Required Windows runtime file is missing: {runtime / filename}')
    tool('clang'); tool('lld-link')
    run(['node', 'scripts/build-offline.mjs'])
    build = ROOT / 'dist/.release-build'
    if build.exists():
        shutil.rmtree(build)
    build.mkdir(parents=True)
    output.mkdir(parents=True, exist_ok=True)
    imports = {
        'kernel32': ['GetModuleFileNameW', 'GetTempPathW', 'GetCurrentProcessId', 'GetSystemDirectoryW',
                     'CreateDirectoryW', 'CreateFileW', 'GetFileSizeEx', 'SetFilePointerEx', 'ReadFile',
                     'WriteFile', 'CloseHandle', 'DeleteFileW', 'RemoveDirectoryW', 'WaitForSingleObject',
                     'GetExitCodeProcess', 'ExitProcess', 'CreateProcessW'],
        'user32': ['MessageBoxW'], 'bcrypt': ['BCryptGenRandom'],
    }
    for dll, names in imports.items():
        definition = build / (dll + '.def')
        definition.write_text('LIBRARY ' + dll + '.dll\nEXPORTS\n' + '\n'.join(' ' + n for n in names) + '\n')
        run([tool('lld-link'), '/lib', f'/def:{definition}', '/machine:x64', f'/out:{build / (dll + ".lib")}'])
    run([tool('clang'), '--target=x86_64-pc-windows-msvc', '-Os', '-fno-builtin', '-fno-stack-protector',
         '-Wall', '-Wextra', '-Werror', '-c', 'installer/bootstrap.c', '-o', build / 'bootstrap.obj'])
    portable = build / 'portable'
    portable.mkdir()
    for filename in RUNTIME_FILES:
        target = portable / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(runtime / filename, target)
    res.brand_executable(portable / 'Markpad.exe', ROOT / 'assets/markpad.ico', version)
    app = portable / 'resources/app'
    app.mkdir(parents=True)
    for folder in ('app', 'desktop'):
        shutil.copytree(ROOT / folder, app / folder)
    (app / 'assets').mkdir()
    for asset in ('markpad.ico', 'markpad.png'):
        shutil.copyfile(ROOT / 'assets' / asset, app / 'assets' / asset)
    app_manifest = {k: manifest[k] for k in ('name', 'productName', 'version', 'description', 'type', 'main')}
    app_manifest['private'] = True
    (app / 'package.json').write_text(json.dumps(app_manifest, indent=2) + '\n')
    for name in ('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt'):
        shutil.copyfile(ROOT / name, portable / name)
    (portable / 'README.txt').write_text(
        f'Markpad {version} - Windows x64 portable\n\n'
        'Extract the entire ZIP to a writable folder and run Markpad.exe.\n'
        'Keep all included runtime files beside the EXE. No Node.js or Python is needed.\n'
        'Settings, unsaved notes, and recovery drafts are stored in the data folder\n'
        'created beside the EXE. Keep this folder when upgrading or moving Markpad.\n'
        'Existing installed/development drafts are not automatically imported.\n'
        'Portable mode makes no PATH or file-association changes.\n'
        'This early release is unsigned. Windows-native launch still needs verification.\n', encoding='utf-8')
    marker = portable / 'markpad-portable.json'
    marker.write_text(json.dumps({'format': 1, 'productId': 'com.markpad.editor'}, indent=2) + '\n')
    portable_zip = output / f'Markpad-{version}-Portable-x64.zip'
    zip_tree(portable, portable_zip)
    marker.unlink()
    (portable / 'README.txt').write_text(
        f'Markpad {version} - Windows x64 installed application\n\n'
        'Launch Markpad from the Start menu. Run Uninstall Markpad.exe to remove it.\n'
        'Your Markdown files and %APPDATA%\\Markpad recovery drafts are not removed\n'
        'by uninstall. The installer offers optional per-user PATH and .md settings.\n'
        'No Node.js or Python is needed to run Markpad.\n', encoding='utf-8')
    uninstaller = bootstrap(build, version, uninstall=True)
    append_payload(uninstaller, version, uninstall=True)
    shutil.copyfile(uninstaller, portable / uninstaller.name)
    installed_files = [{'path': f.relative_to(portable).as_posix(), 'sha256': sha(f), 'bytes': f.stat().st_size}
                       for f in sorted(portable.rglob('*')) if f.is_file()]
    (portable / 'markpad-install.json').write_text(json.dumps({
        'format': 1, 'productId': 'com.markpad.editor', 'version': version, 'files': installed_files
    }, indent=2) + '\n')
    payload = build / 'install-payload.zip'
    install_zip_from_portable(portable_zip, portable, payload)
    installer = bootstrap(build, version)
    append_payload(installer, version, payload=payload)
    final_installer = output / installer.name
    shutil.copyfile(installer, final_installer)
    checksums = output / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{sha(f)}  {f.name}\n' for f in (final_installer, portable_zip)))
    report = {
        'version': version, 'architecture': 'x64', 'electron': runtime_version,
        'baseExeSha256': sha(runtime / 'Markpad.exe'), 'codeSigned': False,
        'windowsExecutionVerified': False,
        'portableBytes': portable_zip.stat().st_size, 'installerBytes': final_installer.stat().st_size,
        'runtimeFiles': len(installed_files) - 1, 'runtimeLocales': ['en-US'],
        'installer': 'native x64 bootstrap + built-in Windows PowerShell 5.1/.NET UI',
        'sourceHashes': {f.relative_to(ROOT).as_posix(): sha(f) for f in sorted(
            [f for name in ('src', 'desktop', 'vendor', 'assets', 'installer') for f in (ROOT / name).rglob('*') if f.is_file()]
            + [ROOT / name for name in ('package.json', 'scripts/build-releases.py', 'scripts/windows-resources.py', 'scripts/build-offline.mjs')])},
        'excluded': ['development source', 'node_modules', 'tests', 'old patches', '.git', 'personal drafts'],
    }
    (output / 'release-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    print('Built:', final_installer, '\nBuilt:', portable_zip)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Release build failed: {error}', file=sys.stderr)
        sys.exit(1)
