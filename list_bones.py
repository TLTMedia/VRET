import bpy
import sys
import os

def list_bones(filepath):
    print('--- BONES ---')
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except Exception as e:
        print('Import-Failed')
        return

    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if not arm:
        print('No-Armature')
        return

    print('Total-Bones')
    print(len(arm.data.bones))
    for bone in arm.data.bones:
        bn = bone.name.lower()
        if 'robo' in bn or 'arm' in bn or 'wire' in bn:
            print(bone.name)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        list_bones(sys.argv[-1])
