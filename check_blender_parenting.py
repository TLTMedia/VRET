import bpy
import sys
import os

def check_parenting(filepath):
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except Exception as e:
        print("Import-Failed")
        return

    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            parent_name = obj.parent.name if obj.parent else 'NONE'
            print(f"Mesh: {obj.name}, Parent: {parent_name}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        check_parenting(sys.argv[-1])
