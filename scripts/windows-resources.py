"""Small dependency-free PE resource reader/writer for Markpad release builds.

Preserves the existing executable and all non-brand resources. No Windows APIs,
external executables, or modifications to code sections are needed.
"""
from __future__ import annotations
import struct
from pathlib import Path


def align(n: int, boundary: int = 4) -> int:
    return (n + boundary - 1) & ~(boundary - 1)


def pe_info(data: bytes | bytearray) -> dict:
    pe = struct.unpack_from('<I', data, 60)[0]
    if data[:2] != b'MZ' or data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Not a Windows PE executable')
    optional = pe + 24
    magic = struct.unpack_from('<H', data, optional)[0]
    if magic not in (0x10b, 0x20b):
        raise ValueError('Unsupported PE optional header')
    directory = optional + (112 if magic == 0x20b else 96)
    sections_start = optional + struct.unpack_from('<H', data, pe + 20)[0]
    count = struct.unpack_from('<H', data, pe + 6)[0]
    sections = []
    for i in range(count):
        off = sections_start + 40 * i
        name, vs, rva, size, raw = struct.unpack_from('<8sIIII', data, off)
        sections.append(dict(name=name.rstrip(b'\0'), vs=vs, rva=rva, size=size, raw=raw, header=off))
    return dict(pe=pe, optional=optional, directory=directory, sections_start=sections_start,
                count=count, sections=sections,
                section_alignment=struct.unpack_from('<I', data, optional + 32)[0],
                file_alignment=struct.unpack_from('<I', data, optional + 36)[0])


def read_resources(data: bytes | bytearray) -> dict:
    info = pe_info(data)
    def offset(rva):
        for section in info['sections']:
            if section['rva'] <= rva < section['rva'] + max(section['vs'], section['size']):
                return section['raw'] + rva - section['rva']
        raise ValueError('Resource RVA is outside executable sections')
    rva, length = struct.unpack_from('<II', data, info['directory'] + 16)
    if not rva:
        return {}
    base = offset(rva)
    def visit(at, depth=0):
        if depth > 4:
            raise ValueError('Resource directory too deep')
        named, ids = struct.unpack_from('<HH', data, base + at + 12)
        result = {}
        for i in range(named + ids):
            key, target = struct.unpack_from('<II', data, base + at + 16 + i * 8)
            if key & 0x80000000:
                text_at = base + (key & 0x7fffffff)
                chars = struct.unpack_from('<H', data, text_at)[0]
                key = bytes(data[text_at + 2:text_at + 2 + chars * 2]).decode('utf-16le')
            if target & 0x80000000:
                result[key] = visit(target & 0x7fffffff, depth + 1)
            else:
                address, size, codepage, _ = struct.unpack_from('<IIII', data, base + target)
                raw = offset(address)
                result[key] = (bytes(data[raw:raw + size]), codepage)
        return result
    return visit(0)


def resource_section(tree: dict, section_rva: int) -> bytes:
    output = bytearray()
    leaves = []
    strings = []
    def ordered(mapping):
        return sorted(mapping, key=lambda k: (0, k) if isinstance(k, str) else (1, k))
    def visit(mapping):
        here = len(output)
        output.extend(b'\0' * (16 + len(mapping) * 8))
        struct.pack_into('<HH', output, here + 12,
                         sum(isinstance(k, str) for k in mapping), sum(isinstance(k, int) for k in mapping))
        for i, key in enumerate(ordered(mapping)):
            entry = here + 16 + 8 * i
            if isinstance(key, str):
                strings.append((entry, key))
            else:
                struct.pack_into('<I', output, entry, key)
            value = mapping[key]
            if isinstance(value, dict):
                target = visit(value) | 0x80000000
            else:
                target = len(output)
                output.extend(b'\0' * 16)
                leaves.append((target, value))
            struct.pack_into('<I', output, entry + 4, target)
        return here
    visit(tree)
    for location, text in strings:
        struct.pack_into('<I', output, location, len(output) | 0x80000000)
        encoded = text.encode('utf-16le')
        output.extend(struct.pack('<H', len(encoded) // 2) + encoded)
    output.extend(b'\0' * (align(len(output)) - len(output)))
    for location, (payload, codepage) in leaves:
        struct.pack_into('<IIII', output, location, section_rva + len(output), len(payload), codepage, 0)
        output.extend(payload)
        output.extend(b'\0' * (align(len(output)) - len(output)))
    return bytes(output)


def version_block(key: str, value: bytes = b'', children=(), value_type=0, value_length=None) -> bytes:
    if value_length is None:
        value_length = len(value) // 2 if value_type == 1 else len(value)
    result = bytearray(struct.pack('<HHH', 0, value_length, value_type) + (key + '\0').encode('utf-16le'))
    result.extend(b'\0' * (align(len(result)) - len(result)))
    result.extend(value)
    for child in children:
        result.extend(b'\0' * (align(len(result)) - len(result)))
        result.extend(child)
    struct.pack_into('<H', result, 0, len(result))
    return bytes(result)


def version_resource(version: str, description='Markpad', filename='Markpad.exe') -> bytes:
    numbers = [int(x) for x in version.split('.')]
    numbers += [0] * (4 - len(numbers))
    if len(numbers) != 4 or any(not 0 <= x <= 65535 for x in numbers):
        raise ValueError('Invalid Windows version')
    hi, lo = (numbers[0] << 16) | numbers[1], (numbers[2] << 16) | numbers[3]
    fixed = struct.pack('<13I', 0xfeef04bd, 0x10000, hi, lo, hi, lo, 0x3f, 0, 0x40004, 1, 0, 0, 0)
    fields = dict(CompanyName='kingjoyeuse', FileDescription=description,
                  FileVersion='.'.join(map(str, numbers)), InternalName=filename,
                  OriginalFilename=filename, ProductName='Markpad', ProductVersion=version,
                  LegalCopyright='Copyright (c) 2026 kingjoyeuse')
    table = version_block('040904B0', children=[version_block(k, (v + '\0').encode('utf-16le'), value_type=1)
                                               for k, v in fields.items()], value_type=1)
    return version_block('VS_VERSION_INFO', fixed, children=[
        version_block('StringFileInfo', children=[table], value_type=1),
        version_block('VarFileInfo', children=[version_block('Translation', struct.pack('<HH', 1033, 1200))], value_type=1)])


def branding(icon: Path, version: str, description='Markpad', filename='Markpad.exe') -> dict:
    data = icon.read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved or kind != 1 or not count:
        raise ValueError('Invalid ICO')
    icons = {}
    group = bytearray(struct.pack('<HHH', 0, 1, count))
    for i in range(count):
        entry = 6 + 16 * i
        width, height, colors, reserved, planes, bits, size, offset = struct.unpack_from('<BBBBHHII', data, entry)
        icons[i + 1] = {1033: (data[offset:offset + size], 0)}
        group.extend(struct.pack('<BBBBHHIH', width, height, colors, reserved, planes, bits, size, i + 1))
    return {3: icons, 14: {1: {1033: (bytes(group), 0)}},
            16: {1: {1033: (version_resource(version, description, filename), 0)}}}


def brand_executable(executable: Path, icon: Path, version: str) -> None:
    data = bytearray(executable.read_bytes())
    info = pe_info(data)
    tree = read_resources(data)
    tree.update(branding(icon, version))
    existing = next((s for s in info['sections'] if s['name'] == b'.mpres'), None)
    if existing and existing is not info['sections'][-1]:
        raise ValueError('An existing Markpad resource section is not last')
    if existing:
        data = data[:existing['raw']]
        rva, raw, header = existing['rva'], existing['raw'], existing['header']
    else:
        header = info['sections_start'] + 40 * info['count']
        if header + 40 > struct.unpack_from('<I', data, info['optional'] + 60)[0]:
            raise ValueError('No room for an additional resource section header')
        rva = align(max(s['rva'] + max(s['vs'], s['size']) for s in info['sections']), info['section_alignment'])
        raw = align(len(data), info['file_alignment'])
        struct.pack_into('<H', data, info['pe'] + 6, info['count'] + 1)
    payload = resource_section(tree, rva)
    raw_size = align(len(payload), info['file_alignment'])
    data.extend(b'\0' * (raw - len(data)))
    data.extend(payload)
    data.extend(b'\0' * (raw_size - len(payload)))
    struct.pack_into('<8sIIIIIIHHI', data, header, b'.mpres\0\0', len(payload), rva, raw_size, raw, 0, 0, 0, 0, 0x40000040)
    initialized = struct.unpack_from('<I', data, info['optional'] + 8)[0]
    struct.pack_into('<I', data, info['optional'] + 8, initialized + raw_size - (existing['size'] if existing else 0))
    struct.pack_into('<II', data, info['directory'] + 16, rva, len(payload))
    struct.pack_into('<II', data, info['directory'] + 32, 0, 0)  # Do not preserve an invalidated signature.
    struct.pack_into('<I', data, info['optional'] + 56, align(rva + len(payload), info['section_alignment']))
    struct.pack_into('<I', data, info['optional'] + 64, 0)  # Optional checksum for a user-mode EXE.
    result = read_resources(data)
    for key in (3, 14, 16):
        if result[key] != tree[key]:
            raise ValueError('PE resource round-trip validation failed')
    executable.write_bytes(data)


def write_res(file: Path, tree: dict) -> None:
    """Write a standard Win32 .res file accepted by Microsoft's and LLVM's linkers."""
    out = bytearray(struct.pack('<IIHHHHIHHII', 0, 32, 0xffff, 0, 0xffff, 0, 0, 0, 0, 0, 0))
    def identifier(value):
        return struct.pack('<HH', 0xffff, value) if isinstance(value, int) else (value + '\0').encode('utf-16le')
    for kind, names in tree.items():
        for name, languages in names.items():
            for language, (payload, _codepage) in languages.items():
                ids = identifier(kind) + identifier(name)
                ids += b'\0' * (align(len(ids)) - len(ids))
                header = struct.pack('<II', len(payload), 8 + len(ids) + 16) + ids
                header += struct.pack('<IHHII', 0, 0x1030, language, 0, 0)
                out.extend(header + payload)
                out.extend(b'\0' * (align(len(out)) - len(out)))
    file.write_bytes(out)
