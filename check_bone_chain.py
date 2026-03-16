
import bpy
import sys
import os

def check_bone_chain(filepath, bone_name):
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except:
        return

    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not arm: return

    if bone_name not in arm.data.bones:
        print(f"Bone {bone_name} not found")
        return

    curr = arm.data.bones[bone_name]
    path = []
    while curr:
        path.append(curr.name)
        curr = curr.parent
    print("Chain: " + " -> ".join(path))

if __name__ == '__main__':
    if len(sys.argv) > 1:
        check_bone_chain(sys.argv[-2], sys.argv[-1])
