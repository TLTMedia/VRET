
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

def inspect_vrm1(data):
    exts = data.get('extensions', {})
    if 'VRMC_vrm' in exts:
        vrm1 = exts['VRMC_vrm']
        print("✓ Found VRMC_vrm extension (VRM 1.0)")
        exprs = vrm1.get('expressions', {})
        preset = exprs.get('preset', {})
        custom = exprs.get('custom', {})
        print(f"  Presets: {list(preset.keys())}")
        print(f"  Custom: {list(custom.keys())}")
        
        # Check node indices for expressions
        if preset:
            first_preset = list(preset.values())[0]
            binds = first_preset.get('morphTargetBinds', [])
            if binds:
                print(f"  Sample bind: {binds[0]}")
    else:
        print("✗ No VRMC_vrm extension found.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = parse_glb(sys.argv[1])
        if data: inspect_vrm1(data)
