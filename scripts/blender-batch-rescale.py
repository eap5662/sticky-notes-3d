"""
Blender Batch Rescale Script for Sticky3D Props

This script rescales GLB files to have consistent real-world dimensions.
Run this in Blender: File > Scripting > Open > Run Script

Usage:
1. Place all GLBs to rescale in a folder (e.g., C:/Users/ihelp/Downloads/props_to_rescale/)
2. Edit SCALE_FACTORS dictionary below with your desired scales
3. Run this script in Blender
4. Rescaled GLBs will be exported to OUTPUT_DIR
"""

import bpy
import os

# ========================================
# CONFIGURATION
# ========================================

# Input/output directories
INPUT_DIR = "C:/Users/ihelp/sticky3d/apps/web/public/models"
OUTPUT_DIR = "C:/Users/ihelp/sticky3d/apps/web/public/models_rescaled"

# Scale factors per prop (multiply current size by this amount)
# Recommended real-world sizes in comments
SCALE_FACTORS = {
    # Batch 1 props - adjust these based on testing
    "Computer-Mouse.glb": 0.1,      # Mouse: ~0.10m (10cm) long
    "Mousepad.glb": 0.3,            # Mousepad: ~0.35m (35cm) wide
    "Mug-supplies.glb": 0.08,       # Mug: ~0.08m (8cm) diameter
    "Notebook.glb": 0.15,           # Notebook: ~0.21m (A5 size)
    "Pen.glb": 0.12,                # Pen: ~0.14m (14cm) long
    "Rubber-Duck.glb": 0.06,        # Duck: ~0.06m (6cm) tall
    "Soda-Can.glb": 0.12,           # Can: ~0.12m (12cm) tall
    "Sticky-notes-pad-thick.glb": 0.075,  # Sticky pad: ~0.075m (7.5cm) square
    "Sticky-notes-pad1.glb": 0.075,       # Sticky pad: ~0.075m (7.5cm) square
    "Tissue-Box.glb": 0.12,         # Tissue box: ~0.12m (12cm) wide
    "Monitor-large.glb": 0.6,       # Monitor: ~0.60m (24") diagonal
    "Whiteboard1.glb": 0.9,         # Whiteboard: ~0.90m (36") wide
}

# Props to skip (already correctly scaled)
SKIP_PROPS = [
    "DeskTopPlane.glb",
    "lamp.glb",
    "monitor_processed.glb",
]

# ========================================
# SCRIPT
# ========================================

def clear_scene():
    """Remove all objects from the scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def import_glb(filepath):
    """Import a GLB file"""
    bpy.ops.import_scene.gltf(filepath=filepath)

def export_glb(filepath):
    """Export scene as GLB"""
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_apply=True  # Apply transforms
    )

def get_bounding_dimensions(obj):
    """Get bounding box dimensions of an object"""
    local_coords = obj.bound_box[:]
    om = obj.matrix_world
    worldify = lambda p: om @ Vector(p[:])
    coords = [worldify(p).to_tuple() for p in local_coords]

    x_coords = [v[0] for v in coords]
    y_coords = [v[1] for v in coords]
    z_coords = [v[2] for v in coords]

    return (
        max(x_coords) - min(x_coords),
        max(y_coords) - min(y_coords),
        max(z_coords) - min(z_coords)
    )

def rescale_prop(filename, scale_factor):
    """Rescale a single prop file"""
    print(f"\n{'='*60}")
    print(f"Processing: {filename}")
    print(f"Scale factor: {scale_factor}x")
    print(f"{'='*60}")

    input_path = os.path.join(INPUT_DIR, filename)
    output_path = os.path.join(OUTPUT_DIR, filename)

    if not os.path.exists(input_path):
        print(f"⚠️  File not found: {input_path}")
        return False

    # Clear scene
    clear_scene()

    # Import GLB
    try:
        import_glb(input_path)
    except Exception as e:
        print(f"❌ Failed to import: {e}")
        return False

    # Get all imported objects
    objects = [obj for obj in bpy.context.scene.objects]

    if not objects:
        print(f"❌ No objects found in {filename}")
        return False

    # Scale all objects
    for obj in objects:
        obj.scale = (scale_factor, scale_factor, scale_factor)
        bpy.context.view_layer.update()

    # Apply scale transforms
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Get new dimensions (for verification)
    main_obj = objects[0]
    dims = get_bounding_dimensions(main_obj)
    print(f"New dimensions: {dims[0]:.3f}m × {dims[1]:.3f}m × {dims[2]:.3f}m")

    # Export
    try:
        export_glb(output_path)
        print(f"✅ Exported: {output_path}")
        return True
    except Exception as e:
        print(f"❌ Failed to export: {e}")
        return False

def main():
    """Main batch rescale function"""
    from mathutils import Vector

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("\n" + "="*60)
    print("STICKY3D BATCH PROP RESCALER")
    print("="*60)
    print(f"Input: {INPUT_DIR}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Props to rescale: {len(SCALE_FACTORS)}")
    print("="*60)

    success_count = 0
    failed_count = 0
    skipped_count = 0

    # Process each prop
    for filename, scale_factor in SCALE_FACTORS.items():
        if filename in SKIP_PROPS:
            print(f"⏭️  Skipping {filename} (already scaled)")
            skipped_count += 1
            continue

        if rescale_prop(filename, scale_factor):
            success_count += 1
        else:
            failed_count += 1

    # Summary
    print("\n" + "="*60)
    print("BATCH RESCALE COMPLETE")
    print("="*60)
    print(f"✅ Success: {success_count}")
    print(f"❌ Failed: {failed_count}")
    print(f"⏭️  Skipped: {skipped_count}")
    print("\nNext steps:")
    print("1. Review rescaled props in models_rescaled/")
    print("2. Test in app to verify scales")
    print("3. Replace original files if satisfied")
    print("="*60)

if __name__ == "__main__":
    main()
