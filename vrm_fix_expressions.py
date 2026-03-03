#!/usr/bin/env python3
"""
Pass 1: Fix VRM 0.x blend-shape expression binds on *_CLEANED.vrm files.

Problems addressed
------------------
1. blink / blink_l / blink_r / joy / angry / sorrow / fun presets have no binds.
2. A subset of models have all presets empty (visemes too).
3. A subset of files are 0-byte failures from a prior cleanup run → skipped with report.

Two face-mesh variants handled
-------------------------------
113-key (full ARKit set, shape key names like "A", "eyeBlinkLeft" …)
 69-key (VALID-only set, shape key names like "AE_AA_h", "ReyeClose_h" …)

Output
------
Overwrites the *_CLEANED.vrm in-place.
Writes a summary to  vrm_fix_expressions_report.txt

Usage
-----
    python3 vrm_fix_expressions.py              # dry run — shows what would change
    python3 vrm_fix_expressions.py --apply      # actually write files
"""

import struct, json, os, sys
from pathlib import Path

DRY_RUN = "--apply" not in sys.argv
MODELS_DIR = Path(__file__).parent / "models"

# ---------------------------------------------------------------------------
# Preset → binds definition for 113-key (full ARKit) face mesh
# weight is VRM 0.x percentage (0-100)
# ---------------------------------------------------------------------------
BINDS_113 = {
    # Visemes (should already be wired, but fill in if missing)
    "a":       [{"idx": 65, "w": 100}],
    "e":       [{"idx": 66, "w": 100}],
    "i":       [{"idx": 67, "w": 100}],
    "o":       [{"idx": 68, "w": 100}],
    "u":       [{"idx": 69, "w": 100}],
    # Blink
    "blink":   [{"idx": 76, "w": 100}, {"idx": 77, "w": 100}],  # eyeBlinkLeft + eyeBlinkRight
    "blink_l": [{"idx": 76, "w": 100}],                          # eyeBlinkLeft
    "blink_r": [{"idx": 77, "w": 100}],                          # eyeBlinkRight
    # Emotions
    "joy":     [{"idx": 88, "w": 100}, {"idx": 89, "w": 100}],  # mouthSmileLeft + mouthSmileRight
    "angry":   [{"idx": 102, "w": 100}, {"idx": 103, "w": 100}, # browDownLeft + browDownRight
                {"idx": 90,  "w":  50}, {"idx": 91,  "w":  50}],# mouthFrownLeft + mouthFrownRight
    "sorrow":  [{"idx": 111, "w": 100},                          # browInnerUp
                {"idx": 53,  "w":  60}, {"idx": 54,  "w":  60}],# h_expr.Rsad_h + Lsad_h
    "fun":     [{"idx": 88, "w": 60}, {"idx": 89, "w": 60}],    # subtle smile (relaxed)
    "neutral": [],
}

# ---------------------------------------------------------------------------
# Preset → binds definition for 69-key (VALID-only) face mesh
# Shape key names have no "h_expressions." prefix here
# ---------------------------------------------------------------------------
BINDS_69 = {
    # Visemes mapped to VALID phoneme shapes
    "a":       [{"idx": 0,  "w": 100}],  # AE_AA_h
    "e":       [{"idx": 2,  "w": 100}],  # Ax_E_h
    "i":       [{"idx": 3,  "w": 100}],  # TD_I_h
    "o":       [{"idx": 1,  "w": 100}],  # AO_a_h
    "u":       [{"idx": 5,  "w": 100}],  # UW_U_h
    # Blink (ReyeClose_h=45, LeyeClose_h=46)
    "blink":   [{"idx": 45, "w": 100}, {"idx": 46, "w": 100}],
    "blink_l": [{"idx": 46, "w": 100}],
    "blink_r": [{"idx": 45, "w": 100}],
    # Emotions
    "joy":     [{"idx": 28, "w": 100}, {"idx": 29, "w": 100}],  # RsmileClose_h + LsmileClose_h
    "angry":   [{"idx": 62, "w": 100}, {"idx": 63, "w": 100},   # RbrowDown_h + LbrowDown_h
                {"idx": 32, "w":  50}, {"idx": 33, "w":  50}],  # RmouthSad_h + LmouthSad_h
    "sorrow":  [{"idx": 67, "w": 100},                           # browInnerUp
                {"idx": 53, "w":  60}, {"idx": 54, "w":  60}],  # Rsad_h + Lsad_h
    "fun":     [{"idx": 28, "w": 60}, {"idx": 29, "w": 60}],    # subtle smile
    "neutral": [],
}

# ---------------------------------------------------------------------------
# GLB read / write helpers
# ---------------------------------------------------------------------------

def read_glb(path):
    """Return (json_dict, bin_bytes, original_json_bytes)."""
    data = path.read_bytes()
    if len(data) < 12:
        return None, None, None
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:  # 'glTF'
        return None, None, None
    offset = 12
    json_bytes = bin_bytes = b''
    while offset < len(data):
        if offset + 8 > len(data):
            break
        chunk_len, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk_data = data[offset: offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:   # JSON
            json_bytes = chunk_data
        elif chunk_type == 0x004E4942:  # BIN
            bin_bytes = chunk_data
    if not json_bytes:
        return None, None, None
    return json.loads(json_bytes), bin_bytes, json_bytes


def write_glb(path, gltf_dict, bin_bytes):
    """Pack gltf_dict + bin_bytes back into a GLB file."""
    json_bytes = json.dumps(gltf_dict, separators=(',', ':')).encode('utf-8')
    # Pad JSON to 4-byte boundary with spaces
    pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b' ' * pad

    chunks = bytearray()
    # JSON chunk
    chunks += struct.pack('<II', len(json_bytes), 0x4E4F534A)
    chunks += json_bytes
    # BIN chunk (only if non-empty)
    if bin_bytes:
        bin_pad = (4 - len(bin_bytes) % 4) % 4
        padded_bin = bin_bytes + b'\x00' * bin_pad
        chunks += struct.pack('<II', len(padded_bin), 0x004E4942)
        chunks += padded_bin

    header = struct.pack('<III', 0x46546C67, 2, 12 + len(chunks))
    path.write_bytes(header + bytes(chunks))

# ---------------------------------------------------------------------------
# Find face mesh: returns (mesh_index, target_names_list, bind_table)
# ---------------------------------------------------------------------------

def find_face_mesh(gltf):
    best = None
    for mi, mesh in enumerate(gltf.get('meshes', [])):
        tgts = mesh.get('extras', {}).get('targetNames') or \
               next((p.get('extras', {}).get('targetNames')
                     for p in mesh.get('primitives', [])), None)
        if not tgts:
            continue
        if best is None or len(tgts) > len(best[1]):
            best = (mi, tgts)
    if best is None:
        return None, None, None
    mi, tgts = best
    n = len(tgts)
    if n == 113:
        return mi, tgts, BINDS_113
    elif n == 69:
        return mi, tgts, BINDS_69
    else:
        return mi, tgts, None  # unknown tier

# ---------------------------------------------------------------------------
# Patch a single file
# ---------------------------------------------------------------------------

def patch_file(vrm_path, dry_run=True):
    if vrm_path.stat().st_size == 0:
        return "SKIP_EMPTY"

    gltf, bin_bytes, _ = read_glb(vrm_path)
    if gltf is None:
        return "SKIP_PARSE_ERROR"

    mesh_idx, target_names, bind_table = find_face_mesh(gltf)
    if mesh_idx is None:
        return "SKIP_NO_FACE_MESH"
    if bind_table is None:
        return f"SKIP_UNKNOWN_TIER({len(target_names)})"

    groups = (gltf.get('extensions', {})
                  .get('VRM', {})
                  .get('blendShapeMaster', {})
                  .get('blendShapeGroups', []))
    if not groups:
        return "SKIP_NO_BLEND_SHAPE_GROUPS"

    changes = []
    for group in groups:
        preset = group.get('presetName', '')
        if preset not in bind_table:
            continue
        desired = bind_table[preset]
        # Only patch if currently empty
        if group.get('binds'):
            continue
        if not desired:
            continue  # neutral — leave empty
        group['binds'] = [
            {"mesh": mesh_idx, "index": b["idx"], "weight": float(b["w"])}
            for b in desired
        ]
        changes.append(preset)

    if not changes:
        return "NO_CHANGE"

    if not dry_run:
        write_glb(vrm_path, gltf, bin_bytes)
    return f"PATCHED:{','.join(changes)}"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    vrm_files = sorted(MODELS_DIR.rglob('*_CLEANED.vrm'))
    vrm_files = [f for f in vrm_files if '_CLEANED_CLEANED' not in f.name]

    results = {"PATCHED": [], "NO_CHANGE": [], "SKIP_EMPTY": [],
               "SKIP_PARSE_ERROR": [], "SKIP_NO_FACE_MESH": [],
               "SKIP_UNKNOWN_TIER": [], "SKIP_NO_BLEND_SHAPE_GROUPS": []}

    print(f"{'DRY RUN' if DRY_RUN else 'APPLYING'} — {len(vrm_files)} *_CLEANED.vrm files\n")

    for vrm in vrm_files:
        result = patch_file(vrm, dry_run=DRY_RUN)
        key = result.split(':')[0]
        bucket = results.get(key, results["SKIP_PARSE_ERROR"])
        bucket.append((vrm.relative_to(MODELS_DIR), result))
        symbol = "✓" if key == "PATCHED" else ("·" if key == "NO_CHANGE" else "⚠")
        print(f"  {symbol} {str(vrm.relative_to(MODELS_DIR)):<55s} {result}")

    # Summary
    report_lines = [
        f"\n{'='*70}",
        f"SUMMARY  ({'DRY RUN — no files written' if DRY_RUN else 'FILES WRITTEN'})",
        f"{'='*70}",
        f"  Patched (expressions fixed):  {len(results['PATCHED'])}",
        f"  No change needed:             {len(results['NO_CHANGE'])}",
        f"  Skipped — 0-byte empty file:  {len(results['SKIP_EMPTY'])}",
        f"  Skipped — parse error:        {len(results['SKIP_PARSE_ERROR'])}",
        f"  Skipped — no face mesh:       {len(results['SKIP_NO_FACE_MESH'])}",
        f"  Skipped — unknown shape tier: {len(results['SKIP_UNKNOWN_TIER'])}",
    ]
    if DRY_RUN:
        report_lines.append("\nRun with --apply to write changes.")

    if results['SKIP_EMPTY']:
        report_lines.append(f"\n0-BYTE FILES (need vrm_cleanup_enhanced.py re-run):")
        for p, _ in results['SKIP_EMPTY']:
            report_lines.append(f"  {p}")

    report = '\n'.join(report_lines)
    print(report)

    report_path = Path(__file__).parent / "vrm_fix_expressions_report.txt"
    report_path.write_text(report)
    print(f"\nReport written to {report_path}")


main()
