#!/bin/zsh
# Pass 2: Convert all *_CLEANED.vrm (VRM 0.x, 113-key) to VRM 1.0
# Output goes to original filename (strips _CLEANED suffix)
#
# Usage: ./blender_batch_vrm1.sh [--dry-run]

SCRIPT="vrm_to_vrm1.py"
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
LOG="vrm1_batch.log"

if [ ! -f "$SCRIPT" ]; then
    echo "ERROR: $SCRIPT not found"; exit 1
fi

DRY_RUN=0
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=1
    echo "DRY RUN mode — listing files only"
fi

total=0
success=0
failed=0
failed_files=()

# Skip _CLEANED_CLEANED files (double-processed anomalies)
while IFS= read -r -d $'\0' file; do
    total=$((total + 1))
    out="${file/_CLEANED.vrm/.vrm}"

    if [[ "$DRY_RUN" == "1" ]]; then
        echo "[$total] $file → $out"
        continue
    fi

    echo "[$total] $file"
    if "$BLENDER" -b -P "$SCRIPT" -- "$file" >> "$LOG" 2>&1; then
        # Check output exists and is non-zero
        if [ -f "$out" ] && [ -s "$out" ]; then
            success=$((success + 1))
            echo "  ✓ → $(basename $out) ($(du -h "$out" | cut -f1))"
        else
            failed=$((failed + 1))
            failed_files+=("$file")
            echo "  ✗ ZERO-BYTE or missing: $out"
        fi
    else
        failed=$((failed + 1))
        failed_files+=("$file")
        echo "  ✗ FAILED: $file"
    fi
done < <(find models -name '*_CLEANED.vrm' ! -name '*_CLEANED_CLEANED*' -print0 | sort -z)

if [[ "$DRY_RUN" == "1" ]]; then
    echo ""
    echo "Total files to process: $total"
    exit 0
fi

echo ""
echo "========================================"
echo "BATCH COMPLETE"
echo "========================================"
echo "Total:   $total"
echo "Success: $success"
echo "Failed:  $failed"
if [ ${#failed_files[@]} -gt 0 ]; then
    echo ""
    echo "Failed files:"
    for f in "${failed_files[@]}"; do
        echo "  $f"
    done
fi
echo ""
echo "Log: $LOG"
