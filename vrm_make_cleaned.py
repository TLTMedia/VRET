#!/usr/bin/env python3
"""
Pass 1b: Create *_CLEANED.vrm from original *.vrm files for models
that have no working CLEANED counterpart (0-byte or missing).

These originals have 65 VALID shape keys (h_expressions.* names).
We wire VRM expression presets directly to those shape keys — no
Blender, no ARKit key copies needed.

Also processes X_Non-validated/ which has never been cleaned.

Output: <group>/<stem>_CLEANED.vrm  (overwrites 0-byte files)

Usage:
    python3 vrm_make_cleaned.py              # dry run
    python3 vrm_make_cleaned.py --apply      # write files
"""

import struct, json, os, sys
from pathlib import Path

DRY_RUN  = "--apply" not in sys.argv
BASE_DIR = Path(__file__).parent
MODELS_DIR = BASE_DIR / "models"

# ---------------------------------------------------------------------------
# Preset binds for 65-key originals (h_expressions.* prefix, indices fixed)
# ---------------------------------------------------------------------------
BINDS_65 = {
    # Visemes
    "a":       [{"idx": 0,  "w": 100}],   # h_expressions.AE_AA_h
    "e":       [{"idx": 2,  "w": 100}],   # h_expressions.Ax_E_h
    "i":       [{"idx": 3,  "w": 100}],   # h_expressions.TD_I_h
    "o":       [{"idx": 1,  "w": 100}],   # h_expressions.AO_a_h
    "u":       [{"idx": 5,  "w": 100}],   # h_expressions.UW_U_h
    # Blink
    "blink":   [{"idx": 45, "w": 100}, {"idx": 46, "w": 100}],  # ReyeClose + LeyeClose
    "blink_l": [{"idx": 46, "w": 100}],                          # LeyeClose
    "blink_r": [{"idx": 45, "w": 100}],                          # ReyeClose
    # Emotions
    "joy":     [{"idx": 28, "w": 100}, {"idx": 29, "w": 100}],  # RsmileClose + LsmileClose
    "angry":   [{"idx": 62, "w": 100}, {"idx": 63, "w": 100},   # RbrowDown + LbrowDown
                {"idx": 32, "w":  50}, {"idx": 33, "w":  50}],  # RmouthSad + LmouthSad
    "sorrow":  [{"idx": 53, "w": 100}, {"idx": 54, "w": 100},   # Rsad + Lsad
                {"idx": 55, "w":  40}, {"idx": 56, "w":  40}],  # Rpityful + Lpityful
    "fun":     [{"idx": 28, "w":  60}, {"idx": 29, "w":  60}],  # subtle smile
    "neutral": [],
}

# ---------------------------------------------------------------------------
# GLB helpers (same as vrm_fix_expressions.py)
# ---------------------------------------------------------------------------

def read_glb(path):
    data = path.read_bytes()
    if len(data) < 12:
        return None, None
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        return None, None
    offset, json_bytes, bin_bytes = 12, b'', b''
    while offset < len(data):
        if offset + 8 > len(data): break
        chunk_len, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk_data = data[offset: offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:
            json_bytes = chunk_data
        elif chunk_type == 0x004E4942:
            bin_bytes = chunk_data
    if not json_bytes:
        return None, None
    return json.loads(json_bytes), bin_bytes


def write_glb(path, gltf_dict, bin_bytes):
    json_bytes = json.dumps(gltf_dict, separators=(',', ':')).encode('utf-8')
    pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b' ' * pad
    chunks = bytearray()
    chunks += struct.pack('<II', len(json_bytes), 0x4E4F534A)
    chunks += json_bytes
    if bin_bytes:
        bin_pad = (4 - len(bin_bytes) % 4) % 4
        padded_bin = bin_bytes + b'\x00' * bin_pad
        chunks += struct.pack('<II', len(padded_bin), 0x004E4942)
        chunks += padded_bin
    header = struct.pack('<III', 0x46546C67, 2, 12 + len(chunks))
    path.write_bytes(header + bytes(chunks))


def find_face_mesh_idx(gltf):
    """Return (mesh_index, key_count) of the mesh with the most morph targets."""
    best_idx, best_n = -1, 0
    for mi, mesh in enumerate(gltf.get('meshes', [])):
        tgts = mesh.get('extras', {}).get('targetNames') or \
               next((p.get('extras', {}).get('targetNames')
                     for p in mesh.get('primitives', [])), None)
        if tgts and len(tgts) > best_n:
            best_idx, best_n = mi, len(tgts)
    return best_idx, best_n

# ---------------------------------------------------------------------------
# Build the cleaned file
# ---------------------------------------------------------------------------

def make_cleaned(orig_path, out_path, dry_run=True):
    if orig_path.stat().st_size == 0:
        return "SKIP_ORIG_EMPTY"

    gltf, bin_bytes = read_glb(orig_path)
    if gltf is None:
        return "SKIP_PARSE_ERROR"

    mesh_idx, n_keys = find_face_mesh_idx(gltf)
    if mesh_idx < 0:
        return "SKIP_NO_FACE_MESH"
    if n_keys != 65:
        return f"SKIP_UNEXPECTED_KEYS({n_keys})"

    groups = (gltf.get('extensions', {})
                  .get('VRM', {})
                  .get('blendShapeMaster', {})
                  .get('blendShapeGroups', []))
    if not groups:
        return "SKIP_NO_BLEND_GROUPS"

    patched = []
    for group in groups:
        preset = group.get('presetName', '')
        if preset not in BINDS_65:
            continue
        if group.get('binds'):
            continue  # already wired — leave it
        desired = BINDS_65[preset]
        if not desired:
            continue
        group['binds'] = [
            {"mesh": mesh_idx, "index": b["idx"], "weight": float(b["w"])}
            for b in desired
        ]
        patched.append(preset)

    if not patched:
        return "NO_CHANGE"

    if not dry_run:
        write_glb(out_path, gltf, bin_bytes)
    return f"CREATED:{','.join(patched)}"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    groups = ['Hispanic', 'MENA', 'NHPI', 'White', 'X_Non-validated']

    tasks = []
    for g in groups:
        folder = MODELS_DIR / g
        if not folder.exists():
            continue
        for orig in sorted(folder.glob('*.vrm')):
            if '_CLEANED' in orig.name or orig.name.endswith('.backup'):
                continue
            cleaned = orig.parent / (orig.stem + '_CLEANED.vrm')
            # Process if CLEANED is missing or 0-byte
            if not cleaned.exists() or cleaned.stat().st_size == 0:
                tasks.append((orig, cleaned))

    print(f"{'DRY RUN' if DRY_RUN else 'APPLYING'} — {len(tasks)} originals to process\n")

    results = {'CREATED': [], 'NO_CHANGE': [], 'SKIP': []}
    for orig, out in tasks:
        result = make_cleaned(orig, out, dry_run=DRY_RUN)
        key = result.split(':')[0]
        bucket = results['CREATED'] if key == 'CREATED' else \
                 results['NO_CHANGE'] if key == 'NO_CHANGE' else results['SKIP']
        bucket.append((orig.relative_to(MODELS_DIR), result))
        symbol = "✓" if key == 'CREATED' else ("·" if key == 'NO_CHANGE' else "⚠")
        print(f"  {symbol} {str(orig.relative_to(MODELS_DIR)):<55s} {result}")

    print(f"\n{'='*70}")
    print(f"SUMMARY  ({'DRY RUN' if DRY_RUN else 'FILES WRITTEN'})")
    print(f"{'='*70}")
    print(f"  Created _CLEANED.vrm:  {len(results['CREATED'])}")
    print(f"  No change needed:      {len(results['NO_CHANGE'])}")
    print(f"  Skipped:               {len(results['SKIP'])}")
    if results['SKIP']:
        for p, r in results['SKIP']:
            print(f"    ⚠ {p}: {r}")
    if DRY_RUN:
        print("\nRun with --apply to write files.")

main()
