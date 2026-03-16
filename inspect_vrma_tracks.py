
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

def inspect_vrma_tracks(data):
    # VRMA stores node names in nodes array
    nodes = data.get('nodes', [])
    animations = data.get('animations', [])
    if not animations:
        print("No animations found")
        return
    
    anim = animations[0]
    channels = anim.get('channels', [])
    print(f"Total channels: {len(channels)}")
    
    track_names = set()
    for chan in channels:
        node_idx = chan.get('target', {}).get('node')
        if node_idx is not None:
            name = nodes[node_idx].get('name', f"Node_{node_idx}")
            track_names.add(name)
    
    print("Animated Nodes in VRMA:")
    for name in sorted(list(track_names)):
        print(f"  - {name}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: inspect_vrma_tracks(data)
