# Quick Start: Prop Onboarding

## TL;DR

```bash
# 1. Drop .glb files into apps/web/public/models/

# 2. Analyze props
pnpm props:analyze

# 3. (Optional) Edit prop-overrides.json for flagged props

# 4. Generate catalog
pnpm props:generate

# 5. Copy generated/prop-catalog-entries.ts → apps/web/src/data/propCatalog.ts

# 6. Test
pnpm dev:web
```

---

## What It Does

The prop onboarding system:

✅ **Skips existing models** (desk, lamp, monitor already approved)

✅ **Auto-detects surfaces** - Looks for named plane nodes in GLBs

✅ **Generates TypeScript code** - Ready to copy-paste into catalog

✅ **Handles 90% automatically** - Only complex props need manual review

---

## Example Output

### After `pnpm props:analyze`:

```
🔍 Analyzing props in apps/web/public/models/...

Found 15 GLB files

⏭️  DeskTopPlane.glb - skipped (already approved)
⏭️  lamp.glb - skipped (already approved)
⏭️  monitor_processed.glb - skipped (already approved)
✓  coffee-mug.glb - 12.3KB - auto-configured
✓  keyboard-mechanical.glb - 18.5KB - auto-configured
⚠️  whiteboard-wall.glb - 45.0KB - needs review
```

### After `pnpm props:generate`:

```typescript
// generated/prop-catalog-entries.ts

{
  id: 'coffee-mug',
  label: 'Coffee Mug',
  url: '/models/coffee-mug.glb',
  anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
},
{
  id: 'keyboard-mechanical',
  label: 'Keyboard Mechanical',
  url: '/models/keyboard-mechanical.glb',
  anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
},
```

---

## Full Documentation

See [docs/prop-onboarding-guide.md](./docs/prop-onboarding-guide.md) for:
- Advanced configuration options
- Surface detection patterns
- Troubleshooting
- Blender workflow
- File size optimization

---

## Files

- `scripts/analyze-props.ts` - Analysis script
- `scripts/generate-catalog.ts` - Generation script
- `prop-overrides.json` - Your manual overrides (edit this)
- `prop-analysis.json` - Generated analysis data
- `PROP_ANALYSIS.md` - Generated review report
- `generated/prop-catalog-entries.ts` - Generated TypeScript code
