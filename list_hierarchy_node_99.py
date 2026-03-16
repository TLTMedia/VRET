
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

def list_hierarchy(data):
    nodes = data.get('nodes', [])
    parents = {i: -1 for i in range(len(nodes))}
    for i, node in enumerate(nodes):
        children = node.get('children', [])
        for c in children:
            parents[c] = i
    
    # Check node 99
    curr = 99
    path = []
    while curr != -1:
        name = nodes[curr].get('name', 'Unnamed')
        path.append(f"{curr} ({name})")
        curr = parents[curr]
    print("Hierarchy of Node 99: " + " <- ".join(path))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: list_hierarchy(data)
