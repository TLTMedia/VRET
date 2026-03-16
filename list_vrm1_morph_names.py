import struct
import json
import sys

def parse_glb(file_path):
    with open(file_path, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF': return
        f.read(8) # skip version, length
        chunk_len = struct.unpack('<I', f.read(4))[0]
        f.read(4) # skip type
        return json.loads(f.read(chunk_len).decode('utf-8'))

def list_morph_targets(data):
    # In glTF, mesh targets are just indices in the accessor.
    # The names are usually in the mesh.extras.targetNames (extension or convention).
    for mesh_idx, mesh in enumerate(data.get('meshes', [])):
        print(f"Mesh {mesh_idx}: {mesh.get('name')}")
        extras = mesh.get('extras', {})
        target_names = extras.get('targetNames', [])
        print(f"  Target names in extras: {len(target_names)}")
        for i, name in enumerate(target_names[:10]):
            print(f"    {i}: {name}")
        if len(target_names) > 10: print("    ...")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: list_morph_targets(data)
