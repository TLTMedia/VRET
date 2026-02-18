#!/bin/zsh

# This script finds all .vrm files in the current directory and its subdirectories,
# then executes the vrm_cleanup.py Blender script on each of them.

# The directory to search in (current directory)
SEARCH_DIR="."

# The Python script to run with Blender
BLENDER_SCRIPT="vrm_cleanup_enhanced.py"

# Check if the Blender script exists
if [ ! -f "$BLENDER_SCRIPT" ]; then
    echo "Error: Blender script '$BLENDER_SCRIPT' not found."
    exit 1
fi

# Find all .vrm files in specified subdirectories of models/ and process them
find models/AIAN models/Asian models/Black models/Hispanic models/MENA models/NHPI models/White -type f -name "*.vrm" -print0 | while IFS= read -r -d $'\0' file; do
    echo "Processing $file..."
    /Applications/Blender.app/Contents/MacOS/Blender -b -P "$BLENDER_SCRIPT" -- "$file"
done

echo "All .vrm files have been processed."
