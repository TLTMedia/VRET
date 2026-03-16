
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

def inspect_colliders(data):
    exts = data.get('extensions', {})
    nodes = data.get('nodes', [])
    
    if 'VRMC_springBone' in exts:
        sb = exts['VRMC_springBone']
        colliders = sb.get('colliders', [])
        collider_groups = sb.get('colliderGroups', [])
        print(f"Total colliders: {len(colliders)}")
        print(f"Total collider groups: {len(collider_groups)}")
        
        for i, group in enumerate(collider_groups):
            name = group.get('name', f"Group_{i}")
            print(f"  Group {i}: {name}")
            for c_idx in group.get('colliders', []):
                c = colliders[c_idx]
                node_idx = c.get('node')
                node_name = nodes[node_idx].get('name', 'Unknown')
                print(f"    - Collider on node {node_idx} ({node_name})")
    else:
        print("No spring bone extension found.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: inspect_colliders(data)
