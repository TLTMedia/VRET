import struct
import json
import sys

def parse_glb(file_path):
    with open(file_path, 'rb') as f:
        # Read Header
        magic = f.read(4)
        if magic != b'glTF':
            print("Not a glTF file.")
            return
        
        version = struct.unpack('<I', f.read(4))[0]
        length = struct.unpack('<I', f.read(4))[0]
        
        print(f"GLB Version: {version}, Total Length: {length}")
        
        # Read Chunk 0 (JSON)
        chunk_length = struct.unpack('<I', f.read(4))[0]
        chunk_type = f.read(4)
        
        if chunk_type != b'JSON':
            print("First chunk is not JSON.")
            return
        
        json_data = f.read(chunk_length)
        data = json.loads(json_data.decode('utf-8'))
        
        return data

def inspect_vrm(data):
    if 'extensions' not in data or 'VRM' not in data['extensions']:
        print("No VRM extension found.")
        return

    vrm = data['extensions']['VRM']
    nodes = data.get('nodes', [])
    
    print("\n--- VRM Info ---")
    if 'meta' in vrm:
        print(f"Title: {vrm['meta'].get('title')}")
        print(f"Version: {vrm['meta'].get('version')}")
    
    print("\n--- Humanoid Bones Mapping ---")
    humanoid = vrm.get('humanoid', {})
    human_bones = humanoid.get('humanBones', [])
    
    # Create a map of node index to node name
    node_names = {i: n.get('name', f"Node_{i}") for i, n in enumerate(nodes)}
    
    for bone in human_bones:
        bone_name = bone.get('bone')
        node_index = bone.get('node')
        mapped_node_name = node_names.get(node_index, "UNKNOWN_NODE")
        print(f"Standard Bone: {bone_name:<15} -> Node Index: {node_index:<3} (Name: {mapped_node_name})")

    print("\n--- All Node Names ---")
    for i, node in enumerate(nodes):
        print(f"{i}: {node.get('name', 'Unnamed')}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_glb_json.py <path_to_vrm>")
    else:
        data = parse_glb(sys.argv[1])
        if data:
            inspect_vrm(data)
