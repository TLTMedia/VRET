#!/bin/zsh
# Master Script: VRM 0.x -> VRM 1.0 with full ARKit Expression Mapping
# This script runs both the Cleanup (Morph Targets) and Conversion (VRM 1.0 Metadata)

CLEANUP_SCRIPT="vrm_cleanup_enhanced.py"
UPGRADE_SCRIPT="vrm_to_vrm1.py"
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
LOG="full_upgrade.log"

echo "Starting Full VRM 1.0 Upgrade Process..." > "$LOG"
date >> "$LOG"

# 1. Find all original models (exclude CLEANED and other patterns)
models=($(find models -type f -name "*.vrm" ! -name "*CLEANED*" ! -name "*_VRM1*" | sort))
total=${#models[@]}
current=0

echo "Found $total models to process." | tee -a "$LOG"

for file in "${models[@]}"; do
    current=$((current + 1))
    echo "[$current/$total] Processing: $file" | tee -a "$LOG"
    
    # Step A: Cleanup/Add ARKit Morph Targets
    # Output: ${file%.vrm}_CLEANED.vrm
    intermediate="${file%.vrm}_CLEANED.vrm"
    echo "  -> Step A: Adding ARKit Morph Targets..." >> "$LOG"
    "$BLENDER" -b -P "$CLEANUP_SCRIPT" -- "$file" >> "$LOG" 2>&1
    
    if [ ! -f "$intermediate" ] || [ ! -s "$intermediate" ]; then
        echo "  ✗ FAILED Step A for $file" | tee -a "$LOG"
        continue
    fi

    # Step B: Convert to VRM 1.0 and Map Expressions
    # Output: $file (Overwrites original with 1.0 version)
    echo "  -> Step B: Upgrading to VRM 1.0 & Mapping Expressions..." >> "$LOG"
    "$BLENDER" -b -P "$UPGRADE_SCRIPT" -- "$intermediate" >> "$LOG" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "  ✓ SUCCESS: $file is now VRM 1.0 with ARKit support" | tee -a "$LOG"
        # Optional: Remove intermediate file to save space
        rm "$intermediate"
    else
        echo "  ✗ FAILED Step B for $file" | tee -a "$LOG"
    fi
done

echo "========================================" | tee -a "$LOG"
echo "PROCESS COMPLETE" | tee -a "$LOG"
date >> "$LOG"
