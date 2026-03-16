
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

def list_root_nodes(data):
    nodes = data.get('nodes', [])
    children = set()
    for n in nodes:
        children.update(n.get('children', []))
    
    roots = [i for i in range(len(nodes)) if i not in children]
    for r in roots:
        name = nodes[r].get('name', 'Unnamed')
        mesh = nodes[r].get('mesh')
        print(f"Root Node {r}: Name='{name}', Mesh={mesh}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: list_root_nodes(data)
