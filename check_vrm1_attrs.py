import bpy
import sys

def check_preset_attrs(filepath):
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except:
        return
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    ext = arm.data.vrm_addon_extension
    ext.spec_version = '1.0'
    preset = ext.vrm1.expressions.preset
    attrs = [a for a in dir(preset) if not a.startswith('_')]
    print("\nPreset attributes:")
    for a in sorted(attrs):
        print("  " + str(a))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        check_preset_attrs(sys.argv[-1])
