"""Inspect built release payloads without pretending to execute Windows setup."""
from pathlib import Path
import hashlib, importlib.util, io, json, struct, zipfile
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pe_resources',root/'scripts/windows-resources.py')
pe=importlib.util.module_from_spec(spec);spec.loader.exec_module(pe)
version=json.loads((root/'package.json').read_text())['version']
folder=root/'dist/releases'
portable=folder/f'Markpad-{version}-Portable-x64.zip'
setup=folder/f'Markpad-{version}-Setup-x64.exe'
report=json.loads((folder/'release-manifest.json').read_text())
for name,digest in report['sourceHashes'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, name
checks=[]
with zipfile.ZipFile(portable) as z:
    assert z.testzip() is None
    names=set(z.namelist())
    assert 'Markpad.exe' in names and 'markpad-portable.json' in names
    assert 'Uninstall Markpad.exe' not in names
    assert not any(n.split('/')[0] in ('src','tests','scripts','installer','.git','data','node_modules') for n in names)
    assert [n for n in names if n.startswith('locales/')] == ['locales/en-US.pak']
    app=z.read('Markpad.exe'); resources=pe.read_resources(app)
    assert resources[3]==pe.branding(root/'assets/markpad.ico',version)[3]
    assert resources[14]==pe.branding(root/'assets/markpad.ico',version)[14]
    assert resources[16]==pe.branding(root/'assets/markpad.ico',version)[16]
    info=pe.pe_info(app)
    assert struct.unpack_from('<II',app,info['directory']+32)==(0,0)
    assert json.loads(z.read('resources/app/package.json'))['version']==version
    assert b'configurePortableProfile(app)' in z.read('resources/app/desktop/main.cjs')
    for name in z.namelist():
        if name.startswith('resources/app/app/') or name.startswith('resources/app/desktop/'):
            assert z.read(name)==(root/name.removeprefix('resources/app/')).read_bytes(), name
    checks.append('portable CRC, layout, app/source parity, marker, locale, icon/version resources')
with setup.open('rb') as stream:
    stream.seek(-32,2); magic,scriptsize,zipsize=struct.unpack('<16sQQ',stream.read(32))
    assert magic==b'MARKPADSETUPv1\0\0'
    stream.seek(-32-zipsize-scriptsize,2)
    script=stream.read(scriptsize).decode('utf-8-sig')
    payload=stream.read(zipsize)
    assert hashlib.sha256(payload).hexdigest() in script
    assert '@@' not in script
    assert '$script:UninstallMode = $false' in script
    assert 'Use Markpad for .md files' in script and 'Add Markpad to my PATH' in script
    assert 'Set-CommandRegistration' in script and 'ms-settings:defaultapps' in script
with zipfile.ZipFile(io.BytesIO(payload)) as z:
    assert z.testzip() is None
    assert 'markpad-portable.json' not in z.namelist()
    assert 'Uninstall Markpad.exe' in z.namelist()
    manifest=json.loads(z.read('markpad-install.json'))
    assert manifest['productId']=='com.markpad.editor'
    for entry in manifest['files']:
        assert hashlib.sha256(z.read(entry['path'])).hexdigest()==entry['sha256'],entry['path']
    uninstaller=z.read('Uninstall Markpad.exe')
    magic,scriptsize,zipsize=struct.unpack('<16sQQ',uninstaller[-32:])
    assert magic==b'MARKPADSETUPv1\0\0' and zipsize==0
    assert '$script:UninstallMode = $true' in uninstaller[-32-scriptsize:-32].decode('utf-8-sig')
    checks.append('embedded installer ZIP CRC, script and payload checksum, every installed file hash, uninstaller')
for line in (folder/'SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split('  ',1)
    with (folder/name).open('rb') as stream:
        h=hashlib.sha256()
        for block in iter(lambda: stream.read(1024*1024),b''):h.update(block)
    assert h.hexdigest()==digest,name
checks.append('published artifact SHA-256 checksums and source-hash correspondence')
result={'passed':checks,'windowsExecutionVerified':False}
print(json.dumps(result,indent=2))
