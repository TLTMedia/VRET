
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

def list_nodes(data):
    nodes = data.get('nodes', [])
    meshes = data.get('meshes', [])
    for i, node in enumerate(nodes):
        mesh_idx = node.get('mesh')
        name = node.get('name', 'Unnamed')
        if mesh_idx is not None:
            mesh_name = meshes[mesh_idx].get('name', 'UnnamedMesh')
            print(f"{i}: Node Name='{name}', Mesh Index={mesh_idx}, Mesh Name='{mesh_name}'")
        else:
            print(f"{i}: Node Name='{name}'")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: list_nodes(data)
