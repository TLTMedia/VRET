"""
Probe v3: test spec_version migration and morph_target_bind structure.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P vrm1_probe3.py -- models/AIAN/AIAN_F_1_Casual_CLEANED.vrm
"""
import bpy, sys, os

vrm_path = sys.argv[-1]
print(f"\n=== PROBING v3: {os.path.basename(vrm_path)} ===")

# Reset scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import
bpy.ops.import_scene.vrm(filepath=vrm_path)

arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
face = next((o for o in bpy.data.objects if 'HighRes' in o.name and o.type == 'MESH'), None)
ext = arm.data.vrm_addon_extension

print(f"Before migration: spec_version={ext.spec_version!r}")
print(f"vrm0 blend_shape_groups: {len(ext.vrm0.blend_shape_master.blend_shape_groups)}")

# --- Check what update_spec_version does ---
print(f"\n--- Testing spec_version='1.0' migration ---")
ext.spec_version = '1.0'
print(f"After setting: spec_version={ext.spec_version!r}")
print(f"is_vrm0={ext.is_vrm0}, is_vrm1={ext.is_vrm1}")

# Check if vrm1 expressions got populated
preset = ext.vrm1.expressions.preset
for name in ['happy', 'sad', 'angry', 'relaxed', 'neutral', 'blink', 'blink_left', 'blink_right', 'aa', 'ih', 'ou', 'ee', 'oh']:
    e = getattr(preset, name, None)
    if e:
        binds = list(e.morph_target_binds)
        print(f"  {name}: morph_target_binds={len(binds)}")

# --- Try manually adding a morph_target_bind to see its structure ---
print(f"\n--- Testing morph_target_bind structure ---")
happy = preset.happy

# Manually add a bind
bind = happy.morph_target_binds.add()
print(f"New bind attrs: {[a for a in dir(bind) if not a.startswith('_')]}")
print(f"bind.node attrs: {[a for a in dir(bind.node) if not a.startswith('_')]}")

# Try setting node to face mesh
bind.node.mesh_object_name = face.name
print(f"After setting mesh_object_name: bind.node.mesh_object_name={bind.node.mesh_object_name!r}")

# Try setting index (shape key index)
# In VRM 1.0, the morph target bind index is the shape key index (int)
if face.data.shape_keys:
    keys = face.data.shape_keys.key_blocks
    # Find eyeBlinkLeft
    # bind.index is a string (shape key name), not int!
    bind.index = 'eyeBlinkLeft'
    bind.weight = 1.0
    print(f"  bind.index={bind.index!r}, bind.weight={bind.weight}")

print(f"happy morph_target_binds after add: {len(list(happy.morph_target_binds))}")

# --- Test humanoid bone assignment ---
print(f"\n--- Humanoid bone setup ---")
# Check current eye bone assignments
left_eye = ext.vrm1.humanoid.human_bones.left_eye
right_eye = ext.vrm1.humanoid.human_bones.right_eye
print(f"left_eye.node.bone_name (before): {left_eye.node.bone_name!r}")
print(f"right_eye.node.bone_name (before): {right_eye.node.bone_name!r}")

# Try auto-assign humanoid bones
bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically(armature_name=arm.name)
print(f"left_eye.node.bone_name (after auto-assign): {left_eye.node.bone_name!r}")
print(f"right_eye.node.bone_name (after auto-assign): {right_eye.node.bone_name!r}")

# Manually set if needed
left_eye.node.bone_name = 'LeftEye'
right_eye.node.bone_name = 'RightEye'
print(f"left_eye.node.bone_name (after manual): {left_eye.node.bone_name!r}")

# --- lookAt type ---
print(f"\n--- LookAt type ---")
look_at = ext.vrm1.look_at
print(f"look_at.type: {look_at.type!r}")
print(f"look_at.type_enum items: {list(look_at.type_enum)}")
# Set to bone-based
look_at.type = 'Bone'
print(f"look_at.type after set: {look_at.type!r}")

# --- Test export to /tmp ---
print(f"\n--- Test export ---")
out_path = "/tmp/test_vrm1_export.vrm"
try:
    bpy.ops.export_scene.vrm(filepath=out_path)
    size = os.path.getsize(out_path)
    print(f"Export SUCCESS: {out_path} ({size:,} bytes)")
except Exception as e2:
    print(f"Export FAILED: {e2}")

# Check what was exported (parse the JSON chunk)
if os.path.exists(out_path) and os.path.getsize(out_path) > 100:
    with open(out_path, 'rb') as f:
        f.seek(12)  # skip GLB header
        chunk_len = int.from_bytes(f.read(4), 'little')
        chunk_type = f.read(4)
        json_data = f.read(chunk_len)

    import json
    gltf = json.loads(json_data.decode('utf-8'))

    extensions = gltf.get('extensions', {})
    vrm_ext = extensions.get('VRMC_vrm', extensions.get('VRM', {}))

    if 'VRMC_vrm' in extensions:
        print(f"\nExported as VRM 1.0 (VRMC_vrm)")
        vrm1_data = extensions['VRMC_vrm']
        print(f"  specVersion: {vrm1_data.get('specVersion', '?')!r}")
        exprs = vrm1_data.get('expressions', {})
        preset_exprs = exprs.get('preset', {})
        print(f"  expressions.preset keys: {list(preset_exprs.keys())}")

        # Check happy expression
        if 'happy' in preset_exprs:
            print(f"  happy: {preset_exprs['happy']}")
    elif 'VRM' in extensions:
        print(f"\nExported as VRM 0.x (VRM)")
        vrm0_data = extensions['VRM']
        print(f"  exporterVersion: {vrm0_data.get('exporterVersion', '?')!r}")
        bsg = vrm0_data.get('blendShapeMaster', {}).get('blendShapeGroups', [])
        print(f"  blendShapeGroups count: {len(bsg)}")
    else:
        print(f"\nExtensions found: {list(extensions.keys())}")
