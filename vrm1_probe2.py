"""
Probe script v2: understand the VRM 1.0 addon API thoroughly.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P vrm1_probe2.py -- models/AIAN/AIAN_F_1_Casual_CLEANED.vrm
"""
import bpy, sys, os

vrm_path = sys.argv[-1]
print(f"\n=== PROBING v2: {os.path.basename(vrm_path)} ===")

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
print(f"\nspec_version: {ext.spec_version}")
print(f"All ext attrs: {[a for a in dir(ext) if not a.startswith('_')]}")

# --- VRM 0.x data ---
print(f"\n--- VRM 0.x blend_shape_groups ---")
vrm0 = ext.vrm0
groups = vrm0.blend_shape_master.blend_shape_groups
for g in groups:
    binds = list(g.binds)
    bind_info = []
    for b in binds:
        bind_info.append(f"mesh={b.mesh.mesh_object_name!r} index={b.index!r} w={b.weight}")
    print(f"  {g.preset_name!r:12s} name={g.name!r} binds={bind_info}")

# --- VRM 1.0 data ---
print(f"\n--- VRM 1.0 expressions ---")
vrm1 = ext.vrm1
exprs = vrm1.expressions
preset = exprs.preset

# What attrs does preset have?
print(f"preset attrs: {[a for a in dir(preset) if not a.startswith('_')]}")

# Inspect one expression
happy = preset.happy
print(f"\nhappy attrs: {[a for a in dir(happy) if not a.startswith('_')]}")
print(f"happy morph_target_binds: {list(happy.morph_target_binds)}")

# Try to find bone-related attrs
for attr in dir(happy):
    if 'bone' in attr.lower() or 'look' in attr.lower() or 'bind' in attr.lower():
        print(f"  happy.{attr} = {getattr(happy, attr, '?')}")

# Check all preset expression names
print(f"\nAll preset expression names:")
for name in dir(preset):
    if not name.startswith('_') and name not in ['bl_rna', 'rna_type', 'name']:
        e = getattr(preset, name, None)
        if hasattr(e, 'morph_target_binds'):
            mtb = list(e.morph_target_binds)
            print(f"  {name}: morph_target_binds={len(mtb)}")

# Custom expressions
custom = list(exprs.custom)
print(f"\nCustom expressions: {len(custom)}")

# --- Humanoid bones ---
print(f"\n--- VRM 1.0 humanoid bones ---")
humanoid = vrm1.humanoid
hbones = humanoid.human_bones
# List eye-related bones
for attr in dir(hbones):
    if 'eye' in attr.lower() or 'look' in attr.lower():
        try:
            bone_ref = getattr(hbones, attr)
            print(f"  {attr}: node={getattr(bone_ref, 'node', None)}")
            if hasattr(bone_ref, 'node') and hasattr(bone_ref.node, 'bone_name'):
                print(f"    bone_name={bone_ref.node.bone_name!r}")
        except Exception as e2:
            print(f"  {attr}: ERROR {e2}")

# Also check VRM 0.x first_person for eye tracking
print(f"\n--- VRM 0.x firstPerson ---")
fp = vrm0.first_person
print(f"  look_at_type_name: {fp.look_at_type_name!r}")
fpb = fp.first_person_bone
fpb_name = fpb.bone_name if hasattr(fpb, 'bone_name') else str(fpb)
print(f"  first_person_bone: {fpb_name!r}")

# --- LookAt in VRM 1.0 ---
print(f"\n--- VRM 1.0 lookAt ---")
look_at = vrm1.look_at
print(f"look_at attrs: {[a for a in dir(look_at) if not a.startswith('_')]}")

# --- Face mesh ---
face = bpy.data.objects.get('H_DDS_HighRes') or bpy.data.objects.get('H_DDS_HighRes.044')
if not face:
    # Try to find by searching
    face = next((o for o in bpy.data.objects if 'HighRes' in o.name and o.type == 'MESH'), None)

if face and face.data.shape_keys:
    keys = face.data.shape_keys.key_blocks
    print(f"\nFace mesh ({face.name}) shape keys: {len(keys)}")
    arkit_keys = [k.name for k in keys if not k.name.startswith('h_') and k.name != 'Basis']
    print(f"  Non-h_expressions keys (ARKit/viseme): {arkit_keys}")
else:
    print(f"\nFace mesh not found or no shape keys")
    print(f"All mesh objects: {[o.name for o in bpy.data.objects if o.type == 'MESH']}")

# --- Eye bones in armature ---
print(f"\nEye-related bones in armature:")
for b in arm.data.bones:
    if 'eye' in b.name.lower() or 'Eye' in b.name:
        print(f"  {b.name!r}")

# --- Available VRM conversion operators ---
print(f"\n--- Available vrm operators (for spec_version change) ---")
all_ops = [op for op in dir(bpy.ops.vrm) if not op.startswith('_')]
for op in all_ops[:50]:
    print(f"  bpy.ops.vrm.{op}")
