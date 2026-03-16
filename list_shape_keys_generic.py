import bpy
import sys
import os

def list_keys(filepath):
    print("\n--- " + str(os.path.basename(filepath)) + " ---")
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except Exception as e:
        print("Import Failed: " + str(e))
        return

    # Find ANY mesh that has shape keys
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]
    if not meshes:
        print("No meshes with shape keys found")
        return

    for mesh in meshes:
        print("\nMesh: " + str(mesh.name))
        keys = mesh.data.shape_keys.key_blocks
        print("Total keys: " + str(len(keys)))
        for kb in keys:
            print("  " + str(kb.name))

if __name__ == "__main__":
    vrm_files = [arg for arg in sys.argv if arg.endswith('.vrm')]
    # Use the first one provided
    if len(sys.argv) > 1:
        list_keys(sys.argv[-1])
