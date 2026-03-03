"""
vrm1_fix_binds.py — Patch missing morphTargetBinds in VRM 1.0 preset expressions.

Root cause
----------
vrm_to_vrm1.py (Pass 2) was supposed to carry the VRM 0.x blend_shape_groups
into VRM 1.0 preset expressions.  Inspection of the source models shows:

  • Only the 5 vowel presets had binds in VRM 0.x:
      a→A  i→I  u→U  e→E  o→O
  • All emotional presets (blink, joy, angry, sorrow, fun, blink_l, blink_r)
    were EMPTY in the VRM 0.x source — nothing to carry forward.
  • The ARKit pipeline added blinkLeft / blinkRight via the ARKIT_TO_VRM1 map
    (these already have correct binds in the VRM 1.0 output).

After Pass 2, the VRM 1.0 files have aa/ih/ou/ee/oh as preset expressions with
empty morphTargetBinds because something in the Blender VRM exporter didn't
write those binds.  This script fixes that without Blender by directly patching
the GLTF JSON inside the GLB.

Mapping (standalone — no source _CLEANED.vrm needed)
----------------------------------------------------
VRM 1.0 preset  morph target name(s)   weight
──────────────  ──────────────────────  ──────
aa              A                       1.0
ih              I                       1.0
ou              U                       1.0
ee              E                       1.0
oh              O                       1.0
blink           eyeBlinkLeft            1.0
                eyeBlinkRight           1.0   (combined blink = both eyes)

Usage
-----
  # Dry-run (prints what would change, writes nothing)
  python vrm1_fix_binds.py --dry-run models/AIAN/AIAN_F_1_Busi.vrm
  python vrm1_fix_binds.py --dry-run models/

  # Apply patches
  python vrm1_fix_binds.py models/
  python vrm1_fix_binds.py models/AIAN/AIAN_F_1_Busi.vrm
"""
import json, struct, sys
from pathlib import Path

# Morph target names to bind for each VRM 1.0 preset that was missing binds.
# Each entry: vrm1_preset_key → [(morph_target_name, weight), …]
VISEME_BINDS = {
    'aa':    [('A', 1.0)],
    'ih':    [('I', 1.0)],
    'ou':    [('U', 1.0)],
    'ee':    [('E', 1.0)],
    'oh':    [('O', 1.0)],
    'blink': [('eyeBlinkLeft', 1.0), ('eyeBlinkRight', 1.0)],
}

# ── GLB helpers ───────────────────────────────────────────────────────────────
def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, _ver, _total = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise ValueError(f'Not a GLB: {path}')
    jlen, jtype = struct.unpack_from('<II', data, 12)
    if jtype != 0x4E4F534A:
        raise ValueError('Chunk 0 is not JSON')
    gltf = json.loads(data[20:20 + jlen])
    bin_data = b''
    bstart = 20 + jlen
    if bstart + 8 <= len(data):
        blen, btype = struct.unpack_from('<II', data, bstart)
        if btype == 0x004E4942:
            bin_data = data[bstart + 8:bstart + 8 + blen]
    return gltf, bin_data


def write_glb(path, gltf, bin_data):
    jbytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    jbytes += b' ' * ((4 - len(jbytes) % 4) % 4)
    chunks = [struct.pack('<II', len(jbytes), 0x4E4F534A) + jbytes]
    if bin_data:
        padded = bin_data + b'\x00' * ((4 - len(bin_data) % 4) % 4)
        chunks.append(struct.pack('<II', len(padded), 0x004E4942) + padded)
    body = b''.join(chunks)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)


# ── GLTF helpers ──────────────────────────────────────────────────────────────
def build_name_to_bind(gltf):
    """Return dict: morph_target_name → {'node': node_idx, 'index': morph_idx}"""
    result = {}
    for m_idx, mesh in enumerate(gltf.get('meshes', [])):
        # Find the GLTF node that owns this mesh
        node_idx = next(
            (ni for ni, n in enumerate(gltf.get('nodes', []))
             if n.get('mesh') == m_idx),
            None
        )
        if node_idx is None:
            continue
        # Morph target names: mesh.extras.targetNames (Blender VRM exporter standard)
        names = mesh.get('extras', {}).get('targetNames', [])
        if not names:  # fallback: first primitive's extras
            prims = mesh.get('primitives', [])
            if prims:
                names = prims[0].get('extras', {}).get('targetNames', [])
        for morph_idx, name in enumerate(names):
            if name and name not in result:
                result[name] = {'node': node_idx, 'index': morph_idx}
    return result


# ── Core patcher ──────────────────────────────────────────────────────────────
def patch_file(path, dry_run=False):
    gltf, bin_data = read_glb(path)

    # Verify this is a VRM 1.0 file
    vrmc = gltf.get('extensions', {}).get('VRMC_vrm', {})
    if not vrmc:
        print(f'  skip {path.name}: no VRMC_vrm extension')
        return 0

    preset_exprs = vrmc.get('expressions', {}).get('preset', {})
    name_map = build_name_to_bind(gltf)

    patched = []
    missing = []

    for vrm1_key, targets in VISEME_BINDS.items():
        expr = preset_exprs.get(vrm1_key)
        if expr is None:
            continue
        if expr.get('morphTargetBinds'):
            continue   # already set — leave it alone

        new_binds = []
        for mt_name, weight in targets:
            entry = name_map.get(mt_name)
            if entry is None:
                missing.append(f'{vrm1_key}→{mt_name}')
                continue
            new_binds.append({**entry, 'weight': weight})

        if new_binds:
            if not dry_run:
                expr['morphTargetBinds'] = new_binds
            patched.append(f'{vrm1_key}({len(new_binds)})')

    if patched:
        if not dry_run:
            write_glb(path, gltf, bin_data)
        tag = '[DRY]' if dry_run else '✓'
        print(f'  {tag} {path.name}: {", ".join(patched)}')
    else:
        print(f'  — {path.name}: nothing to patch')

    if missing:
        print(f'    WARNING morph targets not found: {", ".join(missing)}')

    return len(patched)


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    paths = [a for a in args if not a.startswith('--')]

    if not paths:
        print(__doc__)
        sys.exit(0)

    targets = []
    for arg in paths:
        p = Path(arg)
        if p.is_dir():
            for vrm in sorted(p.rglob('*.vrm')):
                if '_CLEANED' not in vrm.name and 'X_Non-validated' not in str(vrm):
                    targets.append(vrm)
        elif p.suffix == '.vrm' and '_CLEANED' not in p.name:
            targets.append(p)

    if not targets:
        print('No VRM files found.')
        sys.exit(1)

    print(f'{"[DRY RUN] " if dry_run else ""}Processing {len(targets)} file(s)…\n')
    total = 0
    for p in targets:
        total += patch_file(p, dry_run=dry_run)

    print(f'\nDone — {total} expression(s) patched across {len(targets)} file(s).')


if __name__ == '__main__':
    main()
