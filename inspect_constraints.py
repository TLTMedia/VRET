
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

def inspect_constraints(data):
    nodes = data.get('nodes', [])
    found = False
    for i, node in enumerate(nodes):
        exts = node.get('extensions', {})
        if 'VRMC_node_constraint' in exts:
            found = True
            c = exts['VRMC_node_constraint']['constraint']
            print(f"Node {i} ({node.get('name')}): Found VRMC_node_constraint")
            if 'roll' in c: print(f"  Type: Roll, Source: {c['roll']['source']}")
            if 'aim' in c: print(f"  Type: Aim, Source: {c['aim']['source']}")
            if 'rotation' in c: print(f"  Type: Rotation, Source: {c['rotation']['source']}")
    
    if not found:
        print("No VRMC_node_constraint found in model.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: inspect_constraints(data)
