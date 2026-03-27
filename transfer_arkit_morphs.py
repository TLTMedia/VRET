#!/usr/bin/env python3
"""
transfer_arkit_morphs.py

Transfer ARKit blendshapes from a VRM 1.0 reference model to a facecap GLB.

The two meshes have completely different topologies (VRM: ~10k+ verts, facecap: 468 verts),
so morph deltas are retargeted using inverse-distance weighting (IDW) from the k nearest
VRM vertices to each facecap vertex.

Usage:
    python transfer_arkit_morphs.py reference.vrm facecap.glb output.glb

    # Override which mesh to use as source in the VRM (default: auto-detect by ARKit names)
    python transfer_arkit_morphs.py reference.vrm facecap.glb output.glb --vrm-mesh Face

    # Override facecap mesh name (default: first mesh)
    python transfer_arkit_morphs.py reference.vrm facecap.glb output.glb --cap-mesh face

    # Adjust number of nearest neighbours for interpolation (default: 4)
    python transfer_arkit_morphs.py reference.vrm facecap.glb output.glb --k 6

Dependencies:
    pip install pygltflib numpy scipy
"""

import argparse
import copy
import json
import struct
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import KDTree

try:
    from pygltflib import GLTF2, BufferFormat
    import pygltflib
except ImportError:
    sys.exit("Missing dependency: pip install pygltflib numpy scipy")

# ---------------------------------------------------------------------------
# ARKit 52 shape names (Apple standard)
# ---------------------------------------------------------------------------
ARKIT_NAMES = [
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
    "mouthFrownLeft", "mouthFrownRight",
    "mouthFunnel",
    "mouthLeft",
    "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight",
    "mouthPucker",
    "mouthRight",
    "mouthRollLower", "mouthRollUpper",
    "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight",
    "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
    "browDownLeft", "browDownRight",
    "browInnerUp",
    "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff",
    "cheekSquintLeft", "cheekSquintRight",
    "tongueOut",
]

# ---------------------------------------------------------------------------
# GLTF accessor helpers
# ---------------------------------------------------------------------------
COMPONENT_DTYPE = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}
TYPE_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
          "MAT2": 4, "MAT3": 9, "MAT4": 16}


def read_accessor(gltf, blob, idx):
    """Return accessor data as float32 numpy array (count, num_components)."""
    acc = gltf.accessors[idx]
    bv  = gltf.bufferViews[acc.bufferView]
    n   = TYPE_N[acc.type]
    dt  = COMPONENT_DTYPE[acc.componentType]
    item_bytes = np.dtype(dt).itemsize * n
    stride = bv.byteStride if bv.byteStride else item_bytes
    start  = (bv.byteOffset or 0) + (acc.byteOffset or 0)

    out = np.empty((acc.count, n), dtype=np.float32)
    for i in range(acc.count):
        raw = blob[start + i * stride : start + i * stride + item_bytes]
        vals = np.frombuffer(raw, dtype=dt)
        out[i] = vals.astype(np.float32)
    return out


# ---------------------------------------------------------------------------
# GLTF accessor write helpers
# ---------------------------------------------------------------------------
def pack_vec3_array(arr: np.ndarray) -> bytes:
    """Pack (N, 3) float32 array to bytes."""
    return arr.astype(np.float32).tobytes()


def append_accessor(gltf, data_bytes, count, component_type=5126, type_str="VEC3",
                    include_minmax=False, values=None):
    """Append a bufferView + accessor for raw bytes, return accessor index."""
    bv_idx = len(gltf.bufferViews)
    buf = gltf.buffers[0]

    # Current binary blob
    blob = gltf.binary_blob() or b""
    # Align to 4 bytes
    pad = (4 - len(blob) % 4) % 4
    blob = blob + b"\x00" * pad + data_bytes
    gltf.set_binary_blob(blob)
    buf.byteLength = len(blob)

    bv = pygltflib.BufferView(
        buffer=0,
        byteOffset=len(blob) - len(data_bytes),
        byteLength=len(data_bytes),
    )
    gltf.bufferViews.append(bv)

    acc = pygltflib.Accessor(
        bufferView=bv_idx,
        componentType=component_type,
        count=count,
        type=type_str,
    )
    if include_minmax and values is not None:
        acc.min = values.min(axis=0).tolist()
        acc.max = values.max(axis=0).tolist()

    acc_idx = len(gltf.accessors)
    gltf.accessors.append(acc)
    return acc_idx


# ---------------------------------------------------------------------------
# Mesh discovery
# ---------------------------------------------------------------------------
def find_mesh_with_arkit(gltf, preferred_name=None):
    """Return (mesh_idx, prim_idx, target_names) for best ARKit face mesh."""
    best = None
    best_count = 0

    for mi, mesh in enumerate(gltf.meshes):
        if preferred_name and mesh.name != preferred_name:
            continue
        names = (mesh.extras or {}).get("targetNames", []) if mesh.extras else []
        arkit_count = sum(1 for n in names if n in ARKIT_NAMES)
        if arkit_count > best_count:
            best_count = arkit_count
            # Find prim with POSITION
            for pi, prim in enumerate(mesh.primitives):
                if prim.attributes.POSITION is not None and prim.targets:
                    best = (mi, pi, names)
                    break

    if best is None:
        raise RuntimeError(
            "No mesh with ARKit morph targets found in VRM. "
            "Try --vrm-mesh <MeshName> to specify manually."
        )
    return best


def find_cap_mesh(gltf, preferred_name=None):
    """Return (mesh_idx, prim_idx) for the facecap face mesh."""
    for mi, mesh in enumerate(gltf.meshes):
        if preferred_name and mesh.name != preferred_name:
            continue
        for pi, prim in enumerate(mesh.primitives):
            if prim.attributes.POSITION is not None:
                return mi, pi
    raise RuntimeError("No mesh found in facecap GLB.")


# ---------------------------------------------------------------------------
# Core retargeting
# ---------------------------------------------------------------------------
def normalise_xy(pts2d: np.ndarray) -> tuple:
    """
    Normalise a (N,2) array to [-1,1] per axis.
    Returns (normalised, lo, hi) so inverse can be applied.
    """
    lo = pts2d.min(axis=0)
    hi = pts2d.max(axis=0)
    span = (hi - lo)
    span[span < 1e-8] = 1.0          # guard degenerate axis
    normed = 2.0 * (pts2d - lo) / span - 1.0
    return normed, lo, hi


def retarget_morphs(vrm_base: np.ndarray, vrm_morphs: dict,
                    cap_base: np.ndarray, k: int = 4) -> dict:
    """
    Retarget VRM morph deltas onto the facecap mesh.

    Strategy: The VRM face skin mesh is nearly 2D (Z-variance << X/Y-variance).
    We identify the two "frontal" axes (highest variance) in both meshes, normalise
    each to [-1,1] independently (so forehead→chin and left→right both map to the same
    range regardless of mesh scale), then do 2D IDW nearest-neighbour matching.
    Morph deltas are returned in the cap mesh's local 3D coordinate space.

    Returns {name: (C, 3) delta array}.
    """
    # --- 1. Centre both ---
    vrm_c = vrm_base.mean(axis=0)
    cap_c = cap_base.mean(axis=0)
    vrm_a = vrm_base - vrm_c      # (V, 3)
    cap_a = cap_base - cap_c      # (C, 3)

    # --- 2. Identify the 2 "frontal" axes in the VRM (highest X/Y/Z variance) ---
    vrm_var = vrm_a.var(axis=0)
    vrm_depth_ax  = int(np.argmin(vrm_var))   # smallest variance = depth axis
    vrm_frontal   = [i for i in range(3) if i != vrm_depth_ax]   # 2 axes
    print(f"  VRM variance: {vrm_var.round(4)}  → frontal axes: {vrm_frontal}, depth: {vrm_depth_ax}")

    # --- 3. Identify the 2 "frontal" axes in cap (highest variance) ---
    cap_var = cap_a.var(axis=0)
    cap_depth_ax  = int(np.argmin(cap_var))
    cap_frontal   = [i for i in range(3) if i != cap_depth_ax]
    print(f"  Cap variance: {cap_var.round(4)}  → frontal axes: {cap_frontal}, depth: {cap_depth_ax}")

    # --- 4. Build 2D arrays (frontal slices) ---
    # Filter VRM to "active expression region" only: vertices that are non-zero in
    # at least one morph target.  This excludes neck/scalp/ear vertices that bloat
    # the min/max normalisation and cause eye/brow regions to map incorrectly.
    active_mask = np.zeros(len(vrm_base), dtype=bool)
    for delta in vrm_morphs.values():
        active_mask |= (np.linalg.norm(delta, axis=1) > 1e-5)
    print(f"  Active (expression-region) VRM vertices: {active_mask.sum()} / {len(vrm_base)}")

    vrm_active    = vrm_a[active_mask]            # (V_active, 3)
    vrm_active_2d = vrm_active[:, vrm_frontal]    # (V_active, 2)
    cap_2d        = cap_a[:, cap_frontal]          # (C, 2)

    # --- 5. Normalise each axis to [-1, 1] using active face region for VRM ---
    vrm_norm, vrm_lo, vrm_hi = normalise_xy(vrm_active_2d)
    cap_norm, cap_lo, cap_hi = normalise_xy(cap_2d)

    # Sanity: check orientation — the second frontal axis should be Y-up in both.
    # If the cap Y axis is inverted vs VRM Y axis we flip it.
    # Heuristic: more vertices at top of forehead than at bottom;
    # but since we normalise to [-1,1] and both meshes should have similar distribution
    # in the up/down direction, this is usually fine.

    # --- 6. 2D KD-tree over active region ---
    print(f"  Building 2D KD-tree over {len(vrm_norm)} active VRM face vertices …")
    tree = KDTree(vrm_norm)
    print(f"  Querying {len(cap_norm)} cap vertices (k={k}) …")
    dists, local_idxs = tree.query(cap_norm, k=k)   # (C, k) — indices into active set

    # Map local indices back to full VRM vertex indices for delta lookup
    active_indices = np.where(active_mask)[0]        # (V_active,)
    idxs = active_indices[local_idxs]                # (C, k) — full VRM indices

    eps = 1e-8
    weights = 1.0 / (dists + eps)
    weights /= weights.sum(axis=1, keepdims=True)

    # --- 7. IDW retarget with axis remapping ---
    # Scale deltas from VRM-normalised space back to cap local space.
    # The normalisation axes span different physical distances in each mesh,
    # so we scale each frontal delta component accordingly.
    vrm_span = (vrm_hi - vrm_lo)             # (2,) — active VRM face span per axis
    cap_span = (cap_hi - cap_lo)             # (2,) — cap face span per axis
    axis_scale = cap_span / (vrm_span + 1e-8)   # (2,)

    vrm_depth_span = vrm_active[:, vrm_depth_ax].max() - vrm_active[:, vrm_depth_ax].min()
    cap_depth_span  = cap_a[:, cap_depth_ax].max()  - cap_a[:, cap_depth_ax].min()
    depth_scale     = cap_depth_span / (vrm_depth_span + 1e-8)

    cap_morphs = {}
    for name, vrm_delta in vrm_morphs.items():
        nbr = vrm_delta[idxs]                              # (C, k, 3)
        delta_vrm = (weights[:, :, np.newaxis] * nbr).sum(axis=1)  # (C, 3)

        # Remap delta axes: VRM frontal/depth → cap frontal/depth
        delta_cap = np.zeros_like(delta_vrm)
        delta_cap[:, cap_frontal[0]] = delta_vrm[:, vrm_frontal[0]] * axis_scale[0]
        delta_cap[:, cap_frontal[1]] = delta_vrm[:, vrm_frontal[1]] * axis_scale[1]
        delta_cap[:, cap_depth_ax]   = delta_vrm[:, vrm_depth_ax]  * depth_scale

        cap_morphs[name] = delta_cap.astype(np.float32)

    return cap_morphs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Transfer ARKit morphs from VRM to facecap GLB")
    ap.add_argument("vrm",     help="VRM 1.0 reference file (.vrm)")
    ap.add_argument("facecap", help="Neutral facecap scan (.glb)")
    ap.add_argument("output",  help="Output GLB with ARKit morphs")
    ap.add_argument("--vrm-mesh", default=None, help="VRM mesh name to use as source")
    ap.add_argument("--cap-mesh", default=None, help="Facecap mesh name to write into")
    ap.add_argument("--k", type=int, default=4, help="Nearest neighbours for IDW (default 4)")
    args = ap.parse_args()

    # -----------------------------------------------------------------------
    # 1. Load VRM
    # -----------------------------------------------------------------------
    print(f"[1/5] Loading VRM: {args.vrm}")
    # VRM files are GLB binary but have a .vrm extension — load_binary handles that
    vrm = GLTF2.load_binary(args.vrm)
    vrm_blob = vrm.binary_blob()
    if not vrm_blob:
        sys.exit("VRM has no binary blob — is it a valid GLB?")

    mi, pi, vrm_target_names = find_mesh_with_arkit(vrm, args.vrm_mesh)
    vrm_prim = vrm.meshes[mi].primitives[pi]
    print(f"  VRM mesh: '{vrm.meshes[mi].name}'  "
          f"({len(vrm_target_names)} targets, {vrm.accessors[vrm_prim.attributes.POSITION].count} verts)")

    # Base positions
    vrm_base = read_accessor(vrm, vrm_blob, vrm_prim.attributes.POSITION)

    # Morph target deltas — only ARKit names present in this VRM
    arkit_in_vrm = {name: i for i, name in enumerate(vrm_target_names) if name in ARKIT_NAMES}
    print(f"  ARKit shapes found: {len(arkit_in_vrm)}")
    if not arkit_in_vrm:
        sys.exit("No ARKit morph targets found in VRM — is this a VRM 1.0 + ARKit file?")

    vrm_morphs = {}
    for name, tidx in arkit_in_vrm.items():
        target = vrm_prim.targets[tidx]
        if "POSITION" not in target:
            continue
        delta = read_accessor(vrm, vrm_blob, target["POSITION"])
        vrm_morphs[name] = delta

    # -----------------------------------------------------------------------
    # 2. Load facecap GLB
    # -----------------------------------------------------------------------
    print(f"[2/5] Loading facecap GLB: {args.facecap}")
    cap = GLTF2().load(args.facecap)
    cap_blob = cap.binary_blob() or b""

    cmi, cpi = find_cap_mesh(cap, args.cap_mesh)
    cap_prim = cap.meshes[cmi].primitives[cpi]
    cap_mesh = cap.meshes[cmi]
    cap_vert_count = cap.accessors[cap_prim.attributes.POSITION].count
    print(f"  Facecap mesh: '{cap_mesh.name}'  ({cap_vert_count} verts)")

    cap_base = read_accessor(cap, cap_blob, cap_prim.attributes.POSITION)

    # -----------------------------------------------------------------------
    # 3+4. Align coordinate systems and retarget
    # -----------------------------------------------------------------------
    print("[3/5] Aligning coordinate systems (PCA rotation + scale) …")
    print(f"[4/5] Retargeting {len(vrm_morphs)} morph targets …")
    cap_morphs = retarget_morphs(vrm_base, vrm_morphs, cap_base, k=args.k)

    # -----------------------------------------------------------------------
    # 5. Write morphs into facecap GLB and save
    # -----------------------------------------------------------------------
    print(f"[5/5] Writing output: {args.output}")

    # Deep-copy so we don't mutate the loaded cap
    out = copy.deepcopy(cap)
    out_blob = bytearray(cap_blob)
    out.set_binary_blob(bytes(out_blob))

    # Ensure buffer exists
    if not out.buffers:
        out.buffers.append(pygltflib.Buffer(byteLength=0))
    out.buffers[0].byteLength = len(out_blob)

    out_prim = out.meshes[cmi].primitives[cpi]
    out_mesh  = out.meshes[cmi]

    # Clear existing targets if any
    out_prim.targets = []
    target_names_ordered = []

    zero_delta = np.zeros((cap_vert_count, 3), dtype=np.float32)

    for name in ARKIT_NAMES:
        delta = cap_morphs.get(name, zero_delta)
        data  = pack_vec3_array(delta)
        acc_idx = append_accessor(out, data, cap_vert_count,
                                  include_minmax=True, values=delta)
        out_prim.targets.append({"POSITION": acc_idx})
        target_names_ordered.append(name)

    # Write targetNames into mesh extras
    if out_mesh.extras is None:
        out_mesh.extras = {}
    out_mesh.extras["targetNames"] = target_names_ordered

    # Persist buffer byte length
    out.buffers[0].byteLength = len(out.binary_blob())

    out.save(args.output)
    out_size = Path(args.output).stat().st_size / 1024 / 1024
    print(f"  Done → {args.output}  ({out_size:.1f} MB, {len(target_names_ordered)} morph targets)")
    print()
    print("  Shapes written:")
    for n in target_names_ordered:
        present = "✓" if n in cap_morphs else "○ (zero — not in VRM)"
        print(f"    {present}  {n}")


if __name__ == "__main__":
    main()
