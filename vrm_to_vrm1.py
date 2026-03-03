"""
Pass 2: Convert _CLEANED.vrm (VRM 0.x, 113-key) to VRM 1.0.

What it does:
  1. Imports *_CLEANED.vrm (VRM 0.x with 37 ARKit + 11 viseme shape keys)
  2. Reads VRM 0.x blend_shape_groups (expressions) before switching
  3. Sets spec_version to '1.0'
  4. Auto-assigns VRM 1.0 humanoid bones (including LeftEye / RightEye)
  5. Sets lookAt type to 'bone' (eye bones driven directly, not morph targets)
  6. Maps VRM 0.x expressions → VRM 1.0 expressions with morph_target_binds
  7. Exports VRM 1.0 to original filename (strips _CLEANED suffix)

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P vrm_to_vrm1.py -- models/AIAN/AIAN_F_1_Casual_CLEANED.vrm
"""
import bpy
import sys
import os

# Map VRM 0.x preset_name → VRM 1.0 expression attribute name on preset
VRM0_TO_VRM1 = {
    'neutral':  'neutral',
    'a':        'aa',
    'i':        'ih',
    'u':        'ou',
    'e':        'ee',
    'o':        'oh',
    'blink':    'blink',
    'joy':      'happy',
    'angry':    'angry',
    'sorrow':   'sad',
    'fun':      'relaxed',
    'blink_l':  'blink_left',
    'blink_r':  'blink_right',
}

# ARKit shape keys → VRM 1.0 expression names
# These are available on the mesh after vrm_cleanup_enhanced.py
ARKIT_TO_VRM1 = {
    'eyeBlinkLeft': 'blink_left',
    'eyeBlinkRight': 'blink_right',
    'eyeWideLeft': 'eye_wide_left',
    'eyeWideRight': 'eye_wide_right',
    'eyeSquintLeft': 'eye_squint_left',
    'eyeSquintRight': 'eye_squint_right',
    'jawOpen': 'jaw_open',
    'jawForward': 'jaw_forward',
    'jawLeft': 'jaw_left',
    'jawRight': 'jaw_right',
    'mouthClose': 'mouth_close',
    'mouthPucker': 'mouth_pucker',
    'mouthSmileLeft': 'mouth_smile_left',
    'mouthSmileRight': 'mouth_smile_right',
    'mouthFrownLeft': 'mouth_frown_left',
    'mouthFrownRight': 'mouth_frown_right',
    'mouthDimpleLeft': 'mouth_dimple_left',
    'mouthDimpleRight': 'mouth_dimple_right',
    'mouthStretchLeft': 'mouth_stretch_left',
    'mouthStretchRight': 'mouth_stretch_right',
    'mouthUpperUpLeft': 'mouth_upper_up_left',
    'mouthUpperUpRight': 'mouth_upper_up_right',
    'mouthLowerDownLeft': 'mouth_lower_down_left',
    'mouthLowerDownRight': 'mouth_lower_down_right',
    'mouthPressLeft': 'mouth_press_left',
    'mouthPressRight': 'mouth_press_right',
    'browDownLeft': 'brow_down_left',
    'browDownRight': 'brow_down_right',
    'browOuterUpLeft': 'brow_outer_up_left',
    'browOuterUpRight': 'brow_outer_up_right',
    'noseSneerLeft': 'nose_sneer_left',
    'noseSneerRight': 'nose_sneer_right',
    'cheekPuff': 'cheek_puff',
    'mouthLeft': 'mouth_left',
    'mouthRight': 'mouth_right',
    'browInnerUp': 'brow_inner_up',
    'mouthFunnel': 'mouth_funnel',
}


def process_vrm(filepath):
    print(f"\n{'='*60}")
    print(f"Processing: {os.path.basename(filepath)}")
    print(f"{'='*60}")

    # --- Reset ---
    if bpy.context.active_object and bpy.context.active_object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # --- Import VRM 0.x ---
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except Exception as e:
        print(f"  FAILED import: {e}")
        return False

    arm  = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    face = next((o for o in bpy.data.objects if 'HighRes' in o.name and o.type == 'MESH'), None)

    if not arm:
        print(f"  SKIP: no armature found")
        return False
    if not face:
        print(f"  SKIP: no face mesh (HighRes) found")
        return False

    ext = arm.data.vrm_addon_extension
    print(f"  Input: spec={ext.spec_version!r}, face={face.name!r}, "
          f"shape_keys={len(face.data.shape_keys.key_blocks) if face.data.shape_keys else 0}")

    # --- Capture VRM 0.x expression binds before spec switch ---
    vrm0_groups = {}
    for g in ext.vrm0.blend_shape_master.blend_shape_groups:
        binds_data = []
        for b in g.binds:
            binds_data.append({
                'index':  b.index,    # shape key name (string)
                'weight': b.weight,
            })
        vrm0_groups[g.preset_name] = binds_data

    print(f"  VRM 0.x groups captured: {list(vrm0_groups.keys())}")

    # --- Switch to VRM 1.0 ---
    ext.spec_version = '1.0'
    print(f"  spec_version → {ext.spec_version!r}")

    # --- Auto-assign humanoid bones ---
    # We must call this AFTER switching to 1.0
    bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically(
        armature_object_name=arm.name
    )

    hbones = ext.vrm1.humanoid.human_bones
    # Verify eye bones assigned; force if auto-assign missed them
    if not hbones.left_eye.node.bone_name:
        hbones.left_eye.node.bone_name = 'LeftEye'
    if not hbones.right_eye.node.bone_name:
        hbones.right_eye.node.bone_name = 'RightEye'
    print(f"  Eye bones: L={hbones.left_eye.node.bone_name!r} "
          f"R={hbones.right_eye.node.bone_name!r}")

    # --- LookAt: bone-based (eye bones are driven by runtime, not expressions) ---
    ext.vrm1.look_at.type = 'bone'

    # --- Expressions setup ---
    preset = ext.vrm1.expressions.preset
    custom = ext.vrm1.expressions.custom
    
    # Clear any existing vrm1 expressions to avoid double-ups or artifacts
    # (Especially important if importing an already converted file)
    for p in [a for a in dir(preset) if not a.startswith('_')]:
        expr = getattr(preset, p, None)
        if hasattr(expr, 'morph_target_binds'):
            while len(expr.morph_target_binds) > 0:
                expr.morph_target_binds.remove(0)
    custom.clear()

    # Find all meshes with shape keys to bind to
    morph_meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]
    
    def add_binds(vrm1_expr, target_index):
        # Look for target_index in all meshes
        for mesh in morph_meshes:
            # For teeth, we often use prefixed names like t_A, t_JawOpen, etc.
            # But the vrm_cleanup_enhanced script creates aliases on the face mesh.
            # If the mesh has a shape key with the exact same name, bind it.
            if target_index in mesh.data.shape_keys.key_blocks:
                bind = vrm1_expr.morph_target_binds.add()
                bind.node.mesh_object_name = mesh.name
                bind.index = target_index
                bind.weight = 1.0
                return True
        return False

    mapped = 0
    skipped = 0
    
    # 1. Map existing VRM 0.x presets
    for vrm0_preset, vrm1_attr in VRM0_TO_VRM1.items():
        binds_data = vrm0_groups.get(vrm0_preset, [])
        if not binds_data:
            continue

        vrm1_expr = getattr(preset, vrm1_attr, None)
        if vrm1_expr is None:
            continue

        for bd in binds_data:
            idx = bd['index']
            # Bind to ANY mesh that has this shape key
            found = False
            for mesh in morph_meshes:
                if idx in mesh.data.shape_keys.key_blocks:
                    bind = vrm1_expr.morph_target_binds.add()
                    bind.node.mesh_object_name = mesh.name
                    bind.index = idx
                    bind.weight = bd['weight']
                    found = True
            if found: mapped += 1
            else: skipped += 1

    # 2. Map ARKit shape keys directly to VRM 1.0 presets (where applicable)
    print(f"  Mapping ARKit shape keys to VRM 1.0 presets...")
    for sk_name, vrm1_attr in ARKIT_TO_VRM1.items():
        vrm1_expr = getattr(preset, vrm1_attr, None)
        if vrm1_expr is not None:
            if len(vrm1_expr.morph_target_binds) > 0:
                continue
            if add_binds(vrm1_expr, sk_name):
                mapped += 1
        else:
            if sk_name not in [e.custom_name for e in custom]:
                custom_expr = custom.add()
                custom_expr.custom_name = sk_name
                if add_binds(custom_expr, sk_name):
                    mapped += 1

    # 3. Add any remaining ARKit shapes
    print(f"  Adding other ARKit/custom expressions...")
    for sk_name in ARKIT_TO_VRM1.keys():
         is_already_mapped = False
         # Check presets
         for p_name in [a for a in dir(preset) if not a.startswith('_')]:
             expr = getattr(preset, p_name, None)
             if hasattr(expr, 'morph_target_binds'):
                 if any(b.index == sk_name for b in expr.morph_target_binds):
                     is_already_mapped = True
                     break
         
         if not is_already_mapped and sk_name not in [e.custom_name for e in custom]:
             custom_expr = custom.add()
             custom_expr.custom_name = sk_name
             if add_binds(custom_expr, sk_name):
                 mapped += 1

    print(f"  Expressions: mapped={mapped} morph_target_binds, skipped={skipped}")

    # --- Determine output path ---
    if '_CLEANED.vrm' in filepath:
        out_path = filepath.replace('_CLEANED.vrm', '.vrm')
    else:
        # Fallback: shouldn't happen in normal batch use
        out_path = filepath.replace('.vrm', '_VRM1.vrm')

    # --- Export VRM 1.0 ---
    try:
        bpy.ops.export_scene.vrm(filepath=out_path)
        size = os.path.getsize(out_path)
        print(f"  ✓ Exported → {os.path.basename(out_path)} ({size:,} bytes)")
        return True
    except Exception as e:
        print(f"  FAILED export: {e}")
        return False


if __name__ == '__main__':
    vrm_file = sys.argv[-1]
    ok = process_vrm(vrm_file)
    sys.exit(0 if ok else 1)
