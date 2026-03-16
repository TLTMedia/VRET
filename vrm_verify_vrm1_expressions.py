import bpy
import sys
import os
import json

def probe_vrm(filepath):
    print(f"\nPROBING: {os.path.basename(filepath)}")
    
    # 1. Check raw GLB JSON first (fastest, no Blender import needed for spec check)
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

    extensions = json_data.get('extensions', {})
    is_vrm1 = 'VRMC_vrm' in extensions
    is_vrm0 = 'VRM' in extensions
    
    if is_vrm1:
        vrm_data = extensions['VRMC_vrm']
        spec = vrm_data.get('specVersion', 'unknown')
        print(f"  ✓ VRM 1.0 (specVersion={spec})")
        
        # Check expressions count in JSON
        exprs = vrm_data.get('expressions', {})
        preset = exprs.get('preset', {})
        custom = exprs.get('custom', {})
        print(f"  ✓ Expressions defined: {len(preset)} preset, {len(custom)} custom")
        
        # Check for ArKit-style expressions
        arkit_keys = ['browInnerUp', 'cheekPuff', 'eyeBlinkLeft', 'eyeWideLeft', 'jawOpen', 'mouthPucker', 'mouthSmileLeft']
        found_arkit = [k for k in arkit_keys if k in preset]
        if found_arkit:
            print(f"  ✓ ArKit expressions found: {len(found_arkit)}/{len(arkit_keys)}")
        else:
            print("  ✗ No ArKit-standard expressions found in preset.")
            
    elif is_vrm0:
        print("  ✗ VRM 0.x (Found 'VRM' extension)")
    else:
        print("  ✗ Not a VRM file (no VRM extension found)")

if __name__ == "__main__":
    # Get all .vrm files that don't have CLEANED in them
    vrm_files = [arg for arg in sys.argv if arg.endswith('.vrm') and 'CLEANED' not in arg]
    
    if not vrm_files:
        print("No .vrm files provided.")
    else:
        for f in vrm_files:
            if os.path.exists(f):
                probe_vrm(f)
            else:
                print(f"File not found: {f}")
