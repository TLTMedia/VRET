
import bpy
import sys
import os

def check_robo_parenting(filepath):
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except:
        return

    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not arm: return

    for bone in arm.data.bones:
        if 'robo' in bone.name.lower():
            parent = bone.parent.name if bone.parent else 'NONE'
            print(f"Bone: {bone.name}, Parent: {parent}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        check_robo_parenting(sys.argv[-1])
