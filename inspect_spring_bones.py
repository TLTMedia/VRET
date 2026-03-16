
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

def inspect_spring_bones(data):
    exts = data.get('extensions', {})
    nodes = data.get('nodes', [])
    
    if 'VRMC_springBone' in exts:
        sb = exts['VRMC_springBone']
        print("✓ Found VRMC_springBone extension")
        
        springs = sb.get('springs', [])
        print(f"  Total springs: {len(springs)}")
        
        for i, spring in enumerate(springs):
            name = spring.get('name', f"Spring_{i}")
            joints = spring.get('joints', [])
            center = spring.get('center')
            print(f"  Spring {i}: {name}")
            print(f"    Joints count: {len(joints)}")
            if joints:
                node_idx = joints[0].get('node')
                node_name = nodes[node_idx].get('name', 'Unknown')
                print(f"    First joint node: {node_idx} ({node_name})")
    else:
        print("✗ No VRMC_springBone extension found.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: inspect_spring_bones(data)
