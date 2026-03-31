"""
clean_seedsan.py — Re-export Seed-san.vrm with spec-compliant VRM 1.0 bone rests.

The VRM Blender add-on (Saturday06) normalizes bone local rotations to identity
on export, which is what the VRM 1.0 spec requires but Seed-san's current file
violates (shoulders at ~120°, legs at ~168°).

Usage (Blender 5.0 background mode):
  "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" \
    --background --python clean_seedsan.py

Output: models/Seed-san-clean.vrm
"""
import bpy
import sys
import os

VRM_IN  = os.path.abspath('models/Seed-san.vrm')
VRM_OUT = os.path.abspath('models/Seed-san-clean.vrm')

print(f'\n[clean_seedsan] Input:  {VRM_IN}')
print(f'[clean_seedsan] Output: {VRM_OUT}')

# Clear default scene first — BEFORE re-enabling the addon.
# read_factory_settings(use_empty=True) resets addon state, so we must
# re-enable the VRM extension AFTER calling it.
bpy.ops.wm.read_factory_settings(use_empty=True)

# Re-enable VRM extension after factory reset (Blender 4.2+ module name)
import addon_utils
addon_utils.enable('bl_ext.user_default.vrm', default_set=True, persistent=True)
print('[clean_seedsan] VRM operator available after re-enable:',
      hasattr(bpy.ops, 'import_scene') and 'vrm' in dir(bpy.ops.import_scene))

# Import VRM
try:
    result = bpy.ops.import_scene.vrm(filepath=VRM_IN)
    print(f'[clean_seedsan] Import result: {result}')
except (AttributeError, RuntimeError) as e:
    print(f'[clean_seedsan] ERROR during import: {e}')
    print('  Install from: https://github.com/saturday06/VRM-Addon-for-Blender')
    sys.exit(1)

# List what was imported
armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes    = [o for o in bpy.data.objects if o.type == 'MESH']
print(f'[clean_seedsan] Imported: {len(armatures)} armature(s), {len(meshes)} mesh(es)')

if not armatures:
    print('[clean_seedsan] ERROR: No armature found after import')
    sys.exit(1)

# Re-export — the VRM add-on normalizes bone rests to identity per VRM 1.0 spec
try:
    result = bpy.ops.export_scene.vrm(filepath=VRM_OUT)
    print(f'[clean_seedsan] Export result: {result}')
    print(f'[clean_seedsan] Done → {VRM_OUT}')
except AttributeError:
    print('[clean_seedsan] ERROR: VRM export operator not found')
    sys.exit(1)
