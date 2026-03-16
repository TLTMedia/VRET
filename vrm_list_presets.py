import sys
import os
import json

def probe_vrm_details(filepath):
    print(f"\nPROBING DETAILS: {os.path.basename(filepath)}")
    with open(filepath, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF':
            print("  [ERROR] Not a glTF/GLB file")
            return
        f.seek(12)
        chunk_len = int.from_bytes(f.read(4), 'little')
        chunk_type = f.read(4)
        if chunk_type != b'JSON':
            print("  [ERROR] First chunk not JSON")
            return
        json_data = json.loads(f.read(chunk_len).decode('utf-8'))

    vrm_data = json_data.get('extensions', {}).get('VRMC_vrm', {})
    exprs = vrm_data.get('expressions', {})
    preset = exprs.get('preset', {})
    
    print(f"  Preset Expression Keys ({len(preset)}):")
    for k in sorted(preset.keys()):
        print(f"    - {k}")

if __name__ == "__main__":
    vrm_files = [arg for arg in sys.argv if arg.endswith('.vrm') and 'CLEANED' not in arg]
    if vrm_files:
        probe_vrm_details(vrm_files[0])
