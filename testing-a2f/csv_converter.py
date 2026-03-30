#!/usr/bin/env python3
"""
Convert Audio2Face-3D animation_frames.csv → JSON for Babylon.js playback.

Usage:
    python a2f_csv_to_json.py animation_frames.csv -o animation.json

The output JSON has this structure:
{
    "fps": 30,
    "frameCount": 1234,
    "blendShapeNames": ["eyeBlinkLeft", "eyeBlinkRight", ...],
    "frames": [
        { "time": 0.0,    "weights": [0.0, 0.0, ...] },
        { "time": 0.0333, "weights": [0.12, 0.0, ...] },
        ...
    ]
}

Weights are stored as a flat array per frame (indexed by blendShapeNames)
to keep file size down vs. per-name objects.
"""

import csv
import json
import argparse
import sys
from pathlib import Path


# A2F outputs PascalCase; ARKit / VRM uses camelCase
def pascal_to_camel(name: str) -> str:
    """EyeBlinkLeft → eyeBlinkLeft"""
    if not name:
        return name
    name_split = name.split('.')
    if len(name_split) < 2:
        return name_split[0][0].lower() + name_split[0][1:]
    else:
        return name_split[1][0].lower() + name_split[1][1:]


# Columns in the CSV that are NOT blendshape weights
SKIP_COLUMNS = {"frame", "time", "timecode", "time_code", "index", ""}


def convert(csv_path: str, out_path: str, fps: int = 30, precision: int = 4):
    rows = []
    bs_names_pascal = []

    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            print("Error: CSV has no header row.", file=sys.stderr)
            sys.exit(1)

        # Identify blendshape columns (everything that isn't metadata)
        bs_names_pascal = [
            col for col in reader.fieldnames
            if col.strip().lower() not in SKIP_COLUMNS
        ]

        for row in reader:
            rows.append(row)

    if not rows:
        print("Error: CSV has no data rows.", file=sys.stderr)
        sys.exit(1)

    # Map PascalCase → camelCase
    bs_names_camel = [pascal_to_camel(n.strip()) for n in bs_names_pascal]

    # Build frames
    frames = []
    for i, row in enumerate(rows):
        # Try to get time from the CSV; fall back to computing from fps
        time_val = None
        for time_col in ("time", "timecode", "time_code"):
            if time_col in row and row[time_col].strip():
                try:
                    time_val = float(row[time_col])
                except ValueError:
                    pass
                break

        if time_val is None:
            time_val = round(i / fps, precision)

        weights = []
        for col in bs_names_pascal:
            try:
                w = round(float(row[col]), precision)
            except (ValueError, KeyError):
                w = 0.0
            weights.append(w)

        frames.append({
            "time": time_val,
            "weights": weights,
        })

    output = {
        "fps": fps,
        "frameCount": len(frames),
        "blendShapeNames": bs_names_camel,
        "frames": frames,
    }

    with open(out_path, "w") as f:
        json.dump(output, f)

    # Size report
    size_kb = Path(out_path).stat().st_size / 1024
    print(f"Wrote {len(frames)} frames ({len(bs_names_camel)} shapes) → {out_path}  ({size_kb:.1f} KB)")
    print(f"Shapes: {', '.join(bs_names_camel[:8])}{'...' if len(bs_names_camel) > 8 else ''}")
    print(f"Duration: {frames[-1]['time']:.2f}s at {fps} fps")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert A2F CSV to JSON for Babylon.js")
    parser.add_argument("csv_file", help="Path to animation_frames.csv from A2F")
    parser.add_argument("-o", "--output", default=None, help="Output JSON path (default: same name .json)")
    parser.add_argument("--fps", type=int, default=30, help="Playback FPS (default: 30)")
    parser.add_argument("--precision", type=int, default=4, help="Decimal places for weights (default: 4)")
    args = parser.parse_args()

    out = args.output or str(Path(args.csv_file).with_suffix(".json"))
    convert(args.csv_file, out, fps=args.fps, precision=args.precision)