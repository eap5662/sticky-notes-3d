#!/usr/bin/env tsx
/**
 * Catalog Generation Script
 *
 * Reads prop-analysis.json and prop-overrides.json to generate:
 * - TypeScript code for propCatalog.ts additions
 * - Updated SurfaceKind type (if new kinds detected)
 * - Summary report
 *
 * Usage: pnpm props:generate
 */

import * as fs from 'fs';
import * as path from 'path';

type SurfaceConfig = {
  nodeName: string;
  kind: string;
  normalSide: 'positive' | 'negative' | 'center';
};

type PropAnalysis = {
  fileName: string;
  tier: number;
  fileSize: string;
  fileSizeBytes: number;
  namedNodes: string[];
  surfaceCandidates: Array<{
    nodeName: string;
    suggestedKind: string;
    confidence: string;
  }>;
  recommendedAnchor: {
    type: 'bbox';
    align: { x: 'center'; y: 'min'; z: 'center' };
  };
  needsReview: boolean;
  autoConfig?: {
    surfaces: SurfaceConfig[];
  };
  skipped?: boolean;
};

type AnalysisReport = Record<string, PropAnalysis>;

type Override =
  | 'accept'
  | 'skip'
  | {
      surfaces?: SurfaceConfig[];
      anchor?: any;
      rotation?: [number, number, number];
    };

type OverridesFile = Record<string, Override>;

const ANALYSIS_FILE = path.join(process.cwd(), 'prop-analysis.json');
const OVERRIDES_FILE = path.join(process.cwd(), 'prop-overrides.json');
const OUTPUT_DIR = path.join(process.cwd(), 'generated');

function kebabToCamelCase(str: string): string {
  return str
    .replace(/\.glb$/, '')
    .split('-')
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

function kebabToTitleCase(str: string): string {
  return str
    .replace(/\.glb$/, '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function generatePropId(fileName: string): string {
  return fileName.replace(/\.glb$/, '');
}

type PropEntry = {
  id: string;
  label: string;
  fileName: string;
  hasSurfaces: boolean;
  surfaces?: SurfaceConfig[];
  anchor: any;
  rotation?: [number, number, number];
};

function main() {
  console.log('📝 Generating catalog entries...\n');

  // Check for analysis file
  if (!fs.existsSync(ANALYSIS_FILE)) {
    console.error(`❌ Analysis file not found: ${ANALYSIS_FILE}`);
    console.error('   Run `pnpm props:analyze` first');
    process.exit(1);
  }

  // Read analysis
  const analysis: AnalysisReport = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf-8'));

  // Read overrides (optional)
  let overrides: OverridesFile = {};
  if (fs.existsSync(OVERRIDES_FILE)) {
    overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
    console.log(`📋 Loaded overrides from ${OVERRIDES_FILE}`);
  }

  // Process each prop
  const propEntries: PropEntry[] = [];
  const skippedProps: string[] = [];
  const manualReviewNeeded: string[] = [];
  const surfaceKinds = new Set<string>();

  for (const [fileName, data] of Object.entries(analysis)) {
    // Skip already-approved props
    if (data.skipped) {
      skippedProps.push(fileName);
      continue;
    }

    // Check overrides
    const override = overrides[fileName];

    // Skip if override says to skip
    if (override === 'skip') {
      skippedProps.push(fileName);
      console.log(`⏭️  ${fileName} - skipped (override)`);
      continue;
    }

    // Determine surface configuration
    let surfaces: SurfaceConfig[] | undefined;

    if (override === 'accept' && data.autoConfig) {
      // Accept auto-config
      surfaces = data.autoConfig.surfaces;
      console.log(`✓ ${fileName} - using auto-config`);
    } else if (override && typeof override === 'object' && override.surfaces) {
      // Use override surfaces
      surfaces = override.surfaces;
      console.log(`✓ ${fileName} - using override surfaces`);
    } else if (data.needsReview && !data.autoConfig) {
      // Needs manual review but no config available
      manualReviewNeeded.push(fileName);
      console.log(`⚠️  ${fileName} - needs manual review (skipping for now)`);
      continue;
    }

    // Collect surface kinds
    if (surfaces) {
      surfaces.forEach((s) => surfaceKinds.add(s.kind));
    }

    // Get anchor (from override or default)
    const anchor =
      override && typeof override === 'object' && override.anchor
        ? override.anchor
        : data.recommendedAnchor;

    // Get rotation (from override or none)
    const rotation =
      override && typeof override === 'object' && override.rotation
        ? override.rotation
        : undefined;

    propEntries.push({
      id: generatePropId(fileName),
      label: kebabToTitleCase(fileName),
      fileName,
      hasSurfaces: !!surfaces && surfaces.length > 0,
      surfaces,
      anchor,
      rotation,
    });
  }

  // Generate TypeScript code
  const code = generateTypeScriptCode(propEntries);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write generated code
  const codePath = path.join(OUTPUT_DIR, 'prop-catalog-entries.ts');
  fs.writeFileSync(codePath, code, 'utf-8');
  console.log(`\n✅ Generated catalog code: ${codePath}`);

  // Generate summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Generation Summary');
  console.log('='.repeat(60));
  console.log(`Total analyzed: ${Object.keys(analysis).length}`);
  console.log(`✓ Generated entries: ${propEntries.length}`);
  console.log(`  - Simple props: ${propEntries.filter((p) => !p.hasSurfaces).length}`);
  console.log(`  - Props with surfaces: ${propEntries.filter((p) => p.hasSurfaces).length}`);
  console.log(`⏭️  Skipped: ${skippedProps.length}`);
  console.log(`⚠️  Manual review needed: ${manualReviewNeeded.length}`);

  if (manualReviewNeeded.length > 0) {
    console.log('\nProps requiring manual configuration:');
    manualReviewNeeded.forEach((f) => console.log(`  - ${f}`));
  }

  if (surfaceKinds.size > 0) {
    console.log('\nSurface kinds detected:');
    Array.from(surfaceKinds)
      .sort()
      .forEach((k) => console.log(`  - ${k}`));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Next steps:');
  console.log('1. Review generated/prop-catalog-entries.ts');
  console.log('2. Copy entries to apps/web/src/data/propCatalog.ts');
  console.log('3. Update SurfaceKind type if new kinds detected');
  console.log('4. Test: pnpm dev:web');
  console.log('='.repeat(60));
}

function generateTypeScriptCode(entries: PropEntry[]): string {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let code = `// ========================================\n`;
  code += `// AUTO-GENERATED PROP CATALOG ENTRIES\n`;
  code += `// Generated: ${timestamp}\n`;
  code += `// Total props: ${entries.length}\n`;
  code += `// ========================================\n\n`;

  code += `// Copy these entries to apps/web/src/data/propCatalog.ts\n`;
  code += `// Add to the PROP_CATALOG array\n\n`;

  // Separate simple and surface props
  const simpleProps = entries.filter((p) => !p.hasSurfaces);
  const surfaceProps = entries.filter((p) => p.hasSurfaces);

  if (simpleProps.length > 0) {
    code += `// ========================================\n`;
    code += `// Simple Props (${simpleProps.length})\n`;
    code += `// ========================================\n\n`;

    for (const prop of simpleProps) {
      code += generatePropEntry(prop);
      code += '\n';
    }
  }

  if (surfaceProps.length > 0) {
    code += `// ========================================\n`;
    code += `// Props with Interactive Surfaces (${surfaceProps.length})\n`;
    code += `// ========================================\n\n`;

    for (const prop of surfaceProps) {
      code += generatePropEntry(prop);
      code += '\n';
    }
  }

  return code;
}

function generatePropEntry(prop: PropEntry): string {
  let code = `{\n`;
  code += `  id: '${prop.id}',\n`;
  code += `  label: '${prop.label}',\n`;
  code += `  url: '/models/${prop.fileName}',\n`;
  code += `  anchor: ${JSON.stringify(prop.anchor)},\n`;

  if (prop.rotation) {
    const [x, y, z] = prop.rotation;
    code += `  defaultRotation: [${x}, ${y}, ${z}] as [number, number, number],\n`;
  }

  if (prop.surfaces && prop.surfaces.length > 0) {
    code += `  surfaces: [\n`;
    for (const surface of prop.surfaces) {
      code += `    {\n`;
      code += `      id: createSurfaceId('${prop.id}-${surface.kind}'),\n`;
      code += `      kind: '${surface.kind}',\n`;
      code += `      nodeName: '${surface.nodeName}',\n`;
      code += `      options: { normalSide: '${surface.normalSide}' },\n`;
      code += `    },\n`;
    }
    code += `  ],\n`;
  }

  code += `},`;

  return code;
}

main();
