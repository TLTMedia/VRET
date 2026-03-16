"""
Probe script: import one VRM 0.x CLEANED file and print what the
saturday06 addon exposes, so we can understand the conversion path.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P vrm1_probe.py -- models/AIAN/AIAN_F_1_Casual_CLEANED.vrm
"""
import bpy, sys, os

vrm_path = sys.argv[-1]
print(f"\n=== PROBING: {os.path.basename(vrm_path)} ===")

# Reset scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import
bpy.ops.import_scene.vrm(filepath=vrm_path)

# Find armature
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if not arm:
    print("ERROR: no armature found"); sys.exit(1)

ext = arm.data.vrm_addon_extension
print(f"\nVRM addon extension attrs: {[a for a in dir(ext) if not a.startswith('_')][:20]}")

# VRM version
if hasattr(ext, 'spec_version'):
    print(f"spec_version: {ext.spec_version}")

# Check vrm0 vs vrm1
has_vrm0 = hasattr(ext, 'vrm0')
has_vrm1 = hasattr(ext, 'vrm1')
print(f"has vrm0: {has_vrm0}, has vrm1: {has_vrm1}")

if has_vrm0 and ext.vrm0:
    vrm0 = ext.vrm0
    groups = vrm0.blend_shape_master.blend_shape_groups
    print(f"\nVRM 0.x blend_shape_groups: {len(groups)}")
    for g in groups:
        binds = list(g.binds)
        print(f"  {g.preset_name!r:12s} name={g.name!r} binds={len(binds)}")

if has_vrm1 and ext.vrm1:
    vrm1 = ext.vrm1
    exprs = vrm1.expressions
    print(f"\nVRM 1.0 expressions preset names:")
    preset = exprs.preset
    for name in ['happy','angry','sad','relaxed','surprised','neutral',
                 'aa','ih','ou','ee','oh','blink','blinkLeft','blinkRight',
                 'lookUp','lookDown','lookLeft','lookRight']:
        e = getattr(preset, name, None)
        if e:
            print(f"  {name}: morphBinds={len(list(e.morph_target_binds))} boneBinds={len(list(e.bone_binds))}")

# Face mesh
face = bpy.data.objects.get('H_DDS_HighRes')
if face and face.data.shape_keys:
    keys = face.data.shape_keys.key_blocks
    print(f"\nFace mesh shape keys: {len(keys)}")
    arkit = [k.name for k in keys if not k.name.startswith('h_') and k.name != 'Basis']
    print(f"  ARKit-named keys: {len(arkit)}")
    print(f"  First 5 ARKit: {arkit[:5]}")
    eye_bones = [b for b in arm.data.bones if 'eye' in b.name.lower() or 'Eye' in b.name]
    print(f"\nEye bones: {[b.name for b in eye_bones]}")
