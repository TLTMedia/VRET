
import json
import sys

def inspect_constraints(filepath):
    with open(filepath, 'rb') as f:
        f.seek(12)
        chunk_len = int.from_bytes(f.read(4), 'little')
        chunk_type = f.read(4)
        if chunk_type != b'JSON':
            print("Error: First chunk is not JSON")
            return
        
        data = json.loads(f.read(chunk_len).decode('utf-8'))
    
    nodes = data.get('nodes', [])
    for i, node in enumerate(nodes):
        ext = node.get('extensions', {}).get('VRMC_node_constraint')
        if ext:
            target_rot = node.get('rotation', [0, 0, 0, 1])
            source_idx = ext.get('constraint', {}).get('rotation', {}).get('source')
            source_node = nodes[source_idx] if source_idx is not None else {}
            source_rot = source_node.get('rotation', [0, 0, 0, 1])
            
            print(f"Node {i} ('{node.get('name', '???')}'):")
            print(f"  Rest Rotation: {target_rot}")
            print(f"  Source {source_idx} ('{source_node.get('name', '???')}'):")
            print(f"    Rest Rotation: {source_rot}")
            # print(json.dumps(ext, indent=2))

if __name__ == '__main__':
    if len(sys.argv) > 1:
        inspect_constraints(sys.argv[1])
