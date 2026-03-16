import bpy
import sys
import os

def check_shape_keys(filepath):
    print("\nCHECKING SHAPE KEYS: " + os.path.basename(filepath))
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except Exception as e:
        print("  [ERROR] Import failed: " + str(e))
        return

    face = next((o for o in bpy.data.objects if 'HighRes' in o.name and o.type == 'MESH'), None)
    if not face or not face.data.shape_keys:
        print("  [ERROR] No face mesh or shape keys found.")
        return

    keys = face.data.shape_keys.key_blocks
    print("  Total shape keys on " + face.name + ": " + str(len(keys)))
    
    arkit_pattern = ['browInnerUp', 'cheekPuff', 'eyeBlinkLeft', 'eyeWideLeft', 'jawOpen', 'mouthPucker', 'mouthSmileLeft']
    found_arkit = [k.name for k in keys if any(p.lower() in k.name.lower() for p in arkit_pattern)]
    
    if found_arkit:
        print("  ✓ ArKit-like shape keys found (" + str(len(found_arkit)) + "):")
        for k in found_arkit[:10]:
            print("    - " + k)
        if len(found_arkit) > 10:
            print("    ... and " + str(len(found_arkit)-10) + " more")
    else:
        print("  ✗ No ArKit-like shape keys found on mesh.")

if __name__ == "__main__":
    vrm_files = [arg for arg in sys.argv if arg.endswith('.vrm') and 'CLEANED' not in arg]
    if vrm_files:
        check_shape_keys(vrm_files[0])
