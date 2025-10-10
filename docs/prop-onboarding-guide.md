# Prop Onboarding Guide

**Last Updated:** October 2025

This guide explains how to add 20-40 props to the project quickly using the automated onboarding system.

---

## Quick Start

### 1. Download Props

Download `.glb` files from [poly.pizza](https://poly.pizza) or other sources.

**Requirements:**
- Format: `.glb` (not `.gltf`)
- File size: < 50KB recommended (< 20KB ideal)
- Naming: Use kebab-case (e.g., `coffee-mug.glb`, `desk-lamp-modern.glb`)

**Tips:**
- Look for low-poly models
- Avoid models with complex materials/textures (they increase file size)
- Check file size before downloading

### 2. Place Files

Drop all `.glb` files into:
```
apps/web/public/models/
```

### 3. Run Analysis

```bash
pnpm props:analyze
```

This scans all models and generates:
- `prop-analysis.json` - Detailed analysis data
- `PROP_ANALYSIS.md` - Human-readable review report

**Output example:**
```
🔍 Analyzing props in apps/web/public/models/...

Found 15 GLB files

⏭️  DeskTopPlane.glb - skipped (already approved)
⏭️  lamp.glb - skipped (already approved)
⏭️  monitor_processed.glb - skipped (already approved)
✓  coffee-mug.glb - 12.3KB - auto-configured
✓  keyboard-mechanical.glb - 18.5KB - auto-configured
⚠️  whiteboard-wall.glb - 45.0KB - needs review
✓  mouse-wireless.glb - 8.2KB - auto-configured
⚠️  tablet-ipad.glb - 32.1KB - needs review

✅ Analysis complete: prop-analysis.json
✅ Review report: PROP_ANALYSIS.md

📋 2 props need review - check PROP_ANALYSIS.md
```

### 4. Review Flagged Props (Optional)

Open `PROP_ANALYSIS.md` to see which props need configuration.

**Props are flagged when:**
- Named plane nodes detected (potential interactive surface)
- Multiple surface candidates found
- File size > 100KB

**For auto-configured props:** Just accept defaults by adding to `prop-overrides.json`:

```json
{
  "whiteboard-wall.glb": "accept"
}
```

**For custom configuration:**

```json
{
  "tablet-ipad.glb": {
    "surfaces": [{
      "nodeName": "ScreenGlass",
      "kind": "screen",
      "normalSide": "positive"
    }]
  }
}
```

**To skip a prop:**

```json
{
  "complex-prop.glb": "skip"
}
```

### 5. Generate Catalog

```bash
pnpm props:generate
```

This creates:
- `generated/prop-catalog-entries.ts` - TypeScript code ready to copy

**Output example:**
```
📝 Generating catalog entries...

📋 Loaded overrides from prop-overrides.json
✓ coffee-mug.glb - auto-configured
✓ keyboard-mechanical.glb - auto-configured
✓ whiteboard-wall.glb - using auto-config
✓ mouse-wireless.glb - auto-configured
✓ tablet-ipad.glb - using override surfaces

============================================================
📊 Generation Summary
============================================================
Total analyzed: 15
✓ Generated entries: 12
  - Simple props: 10
  - Props with surfaces: 2
⏭️  Skipped: 3
⚠️  Manual review needed: 0

============================================================
Next steps:
1. Review generated/prop-catalog-entries.ts
2. Copy entries to apps/web/src/data/propCatalog.ts
3. Update SurfaceKind type if new kinds detected
4. Test: pnpm dev:web
============================================================
```

### 6. Copy to Catalog

Open `generated/prop-catalog-entries.ts` and copy the entries.

Paste into `apps/web/src/data/propCatalog.ts`:

```typescript
export const PROP_CATALOG: PropCatalogEntry[] = [
  // ... existing entries (desk, lamp, monitor) ...

  // ========================================
  // NEW ENTRIES - Paste generated code here
  // ========================================

  {
    id: 'coffee-mug',
    label: 'Coffee Mug',
    url: '/models/coffee-mug.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
  },
  // ... more entries
];
```

### 7. Update Types (If Needed)

If new surface kinds were detected, update the `SurfaceKind` type:

```typescript
// apps/web/src/data/propCatalog.ts
export type SurfaceKind =
  | 'desk'
  | 'screen'
  | 'monitor-arm'
  | 'wall'
  | 'board'  // ← New kind
  | 'tablet'; // ← New kind
```

### 8. Test

```bash
pnpm dev:web
```

Click "Add Prop" → All new props should appear in the menu! ✅

---

## Advanced Configuration

### Custom Anchors

By default, props anchor at `{ x: 'center', y: 'min', z: 'center' }` (center bottom).

**To change anchor point:**

```json
{
  "hanging-plant.glb": {
    "anchor": {
      "type": "bbox",
      "align": { "x": "center", "y": "max", "z": "center" }
    }
  }
}
```

**Anchor options:**
- `x`, `y`, `z`: `'min'` | `'center'` | `'max'`
- `y: 'min'` = bottom (most props)
- `y: 'max'` = top (hanging items)
- `y: 'center'` = middle (wall-mounted items)

### Default Rotation

Some props need to face a specific direction:

```json
{
  "monitor-vertical.glb": {
    "rotation": [0, 1.5708, 0]  // 90° Y-rotation (radians)
  }
}
```

**Common rotations:**
- 45° = `0.7854`
- 90° = `1.5708`
- 180° = `3.1416`
- -90° = `-1.5708`

### Interactive Surfaces

For props with clickable/sticky surfaces (whiteboards, tablets, monitors):

**Option 1: Let script auto-detect**

If the GLB has a named plane node (e.g., "BoardSurface", "ScreenPanel"), the script will detect it.

Accept auto-config:
```json
{
  "whiteboard.glb": "accept"
}
```

**Option 2: Manual configuration**

```json
{
  "custom-board.glb": {
    "surfaces": [{
      "nodeName": "PlaneMesh_042",  // Node name from Blender
      "kind": "wall",
      "normalSide": "positive"
    }]
  }
}
```

**Surface kinds:**
- `desk` - Horizontal work surface
- `screen` - Monitor/display screen
- `wall` - Whiteboard, cork board, canvas
- `monitor-arm` - Articulated mount surface

**Normal side:**
- `positive` - Top face (desk top, front of screen)
- `negative` - Bottom face (desk underside)
- `center` - Mid-plane (rare)

---

## Named Node Patterns (Auto-Detection)

The script looks for these patterns in GLB node names:

**Surfaces:**
- `*Surface*`, `*Plane*`, `*Board*`, `*Screen*`
- `DeskTop*`, `DeskSurface*` → desk
- `Screen*`, `Monitor*` → screen
- `Whiteboard*`, `Corkboard*` → wall

**Examples that auto-detect:**
- ✅ `BoardSurface`
- ✅ `ScreenPlane`
- ✅ `MonitorPanel_001`
- ✅ `desk_top_surface`
- ❌ `Mesh_042` (generic name, won't auto-detect)

---

## Adding Named Nodes in Blender

For props that need interactive surfaces but don't have named nodes:

1. **Open GLB in Blender**
2. **Select the surface mesh** (the flat plane you want interactive)
3. **Rename object** to something like:
   - `BoardSurface` (for whiteboards)
   - `ScreenPlane` (for tablets/monitors)
   - `DeskTopPlane` (for desks)
4. **Export as GLB** (File → Export → glTF 2.0)
   - Format: glTF Binary (.glb)
   - Check "Apply Modifiers"
5. **Re-run analysis** to detect the new node

---

## Troubleshooting

### "No .glb files found"

**Problem:** Models directory is empty

**Solution:** Add `.glb` files to `apps/web/public/models/`

---

### "Analysis file not found"

**Problem:** Trying to generate without running analysis first

**Solution:** Run `pnpm props:analyze` before `pnpm props:generate`

---

### Prop appears but is too large/small in scene

**Problem:** Model scale doesn't match scene scale

**Solution:** In Blender, scale the model before exporting. Scene uses meters (1 unit = 1 meter).

**Typical sizes:**
- Coffee mug: ~0.08m (8cm) diameter
- Keyboard: ~0.45m (45cm) wide
- Monitor: ~0.60m (60cm) wide
- Desk: ~1.5m (150cm) wide

---

### Prop spawns sideways/upside down

**Problem:** Model's local axes don't match scene convention

**Solution:**
1. Add rotation override in `prop-overrides.json`
2. Or fix in Blender: Apply all transforms before export (Ctrl+A → All Transforms)

---

### Surface not detected

**Problem:** GLB has generic node names, script can't find surface

**Solutions:**
1. Open in Blender, rename surface node (see "Adding Named Nodes" above)
2. Manually configure in `prop-overrides.json`

---

### File size too large (> 100KB)

**Problem:** Model has too many vertices or high-res textures

**Solutions:**
1. **Decimate in Blender:**
   - Add Modifier → Decimate
   - Reduce ratio to 0.5 (50% fewer faces)
   - Apply modifier
2. **Simplify materials:**
   - Remove texture maps (use vertex colors instead)
   - Bake textures to smaller resolution
3. **Remove hidden geometry:**
   - Delete internal faces
   - Remove duplicate vertices (Mesh → Clean Up → Merge By Distance)

---

## Commands Reference

```bash
# Analyze all models in apps/web/public/models/
pnpm props:analyze

# Generate catalog entries from analysis
pnpm props:generate

# Show help
pnpm props:help
```

---

## File Structure

```
sticky3d/
├── apps/web/public/models/      # Drop .glb files here
├── scripts/
│   ├── analyze-props.ts         # Analysis script
│   └── generate-catalog.ts      # Generation script
├── prop-analysis.json           # Generated: Analysis data
├── PROP_ANALYSIS.md            # Generated: Review report
├── prop-overrides.json         # Your overrides
└── generated/
    └── prop-catalog-entries.ts  # Generated: TypeScript code
```

---

## Example Workflow

**Onboarding 40 props from poly.pizza:**

1. **Download 40 GLBs** (5 minutes)
2. **Drop in models folder** (30 seconds)
3. **Run `pnpm props:analyze`** (30 seconds)
4. **Review PROP_ANALYSIS.md** (2 minutes)
   - 8 props flagged for review
   - 6 have auto-config available
   - 2 need manual node naming
5. **Edit `prop-overrides.json`** (3 minutes)
   - Accept 6 auto-configs
   - Configure 2 manually
6. **Run `pnpm props:generate`** (10 seconds)
7. **Copy to propCatalog.ts** (1 minute)
8. **Test in browser** (30 seconds)

**Total time: ~12 minutes for 40 props** 🎉

---

## Tips for Bulk Onboarding

1. **Batch download** all models first, then process
2. **Name files descriptively** (helps with auto-labeling)
3. **Accept auto-configs liberally** (can tweak later)
4. **Test incrementally** - add 10 props, test, add 10 more
5. **Keep overrides file** in version control for reproducibility

---

## Getting Props from poly.pizza

**Recommended search filters:**
- Format: GLB
- License: CC0 (public domain)
- Poly count: < 5K triangles
- Keywords: "low poly", "office", "desk", "furniture"

**Good prop categories:**
- Office supplies (pens, notebooks, staplers)
- Desk accessories (lamps, monitors, keyboards)
- Plants (succulents, small potted plants)
- Food/drink (coffee mugs, water bottles)
- Tech (tablets, phones, headphones)
- Storage (boxes, organizers, drawers)

---

## Next Steps

Once props are onboarded:

1. **Categorize in UI** - Add prop categories/filters
2. **Preload common props** - Use `preloadGLTF()` for faster loading
3. **Add prop thumbnails** - Generate preview images for catalog
4. **Prop variations** - Create color/material variants
5. **Prop bundles** - Group related props (desk setup, coffee station, etc.)
