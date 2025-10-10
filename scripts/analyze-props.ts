#!/usr/bin/env tsx
/**
 * Prop Analysis Script
 *
 * Scans apps/web/public/models/ for .glb files and analyzes them:
 * - Extracts metadata (dimensions, file size, node names)
 * - Detects potential interactive surfaces (named plane nodes)
 * - Suggests tier classification
 * - Generates prop-analysis.json for review
 *
 * Usage: pnpm props:analyze
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// GLTFLoader types (simplified - we'll use basic file analysis)
type NodeInfo = {
  name: string;
  type: string;
};

type PropAnalysis = {
  fileName: string;
  tier: 1 | 2 | 3 | 4;
  fileSize: string;
  fileSizeBytes: number;
  namedNodes: string[];
  surfaceCandidates: Array<{
    nodeName: string;
    suggestedKind: 'desk' | 'screen' | 'wall' | 'monitor-arm';
    confidence: 'high' | 'medium' | 'low';
  }>;
  recommendedAnchor: {
    type: 'bbox';
    align: { x: 'center'; y: 'min'; z: 'center' };
  };
  needsReview: boolean;
  autoConfig?: {
    surfaces: Array<{
      nodeName: string;
      kind: string;
      normalSide: 'positive' | 'negative' | 'center';
    }>;
  };
  skipped?: boolean;
  skipReason?: string;
};

type AnalysisReport = Record<string, PropAnalysis>;

// Load approved models from external file
const APPROVED_FILE = path.join(process.cwd(), 'prop-approved.json');
let APPROVED_MODELS: string[] = [];

if (fs.existsSync(APPROVED_FILE)) {
  try {
    const approvedData = JSON.parse(fs.readFileSync(APPROVED_FILE, 'utf-8'));
    APPROVED_MODELS = approvedData.approved || [];
  } catch (err) {
    console.warn('⚠️  Could not read prop-approved.json, using empty approved list');
  }
} else {
  // Fallback to hardcoded list if file doesn't exist
  APPROVED_MODELS = [
    'DeskTopPlane.glb',
    'lamp.glb',
    'monitor_processed.glb',
  ];
}

const MODELS_DIR = path.join(process.cwd(), 'apps/web/public/models');
const OUTPUT_FILE = path.join(process.cwd(), 'prop-analysis.json');

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function detectSurfaceKind(nodeName: string): 'desk' | 'screen' | 'wall' | 'monitor-arm' {
  const name = nodeName.toLowerCase();

  // Screen/monitor patterns
  if (/screen|monitor|display/.test(name)) return 'screen';

  // Desk patterns
  if (/desk.*top|desk.*surface/.test(name)) return 'desk';

  // Arm patterns
  if (/arm|mount/.test(name)) return 'monitor-arm';

  // Board/wall patterns (default for surfaces)
  return 'wall';
}

function detectSurfaceCandidates(nodes: string[]): PropAnalysis['surfaceCandidates'] {
  const candidates: PropAnalysis['surfaceCandidates'] = [];

  for (const nodeName of nodes) {
    const lower = nodeName.toLowerCase();

    // High confidence - explicit surface naming
    if (
      /surface|plane|board|screen/.test(lower) &&
      !/frame|edge|border|back/.test(lower)
    ) {
      candidates.push({
        nodeName,
        suggestedKind: detectSurfaceKind(nodeName),
        confidence: 'high',
      });
      continue;
    }

    // Medium confidence - generic panel/mesh with surface keywords
    if (/(panel|mesh).*\d+/.test(lower) && nodes.length < 10) {
      candidates.push({
        nodeName,
        suggestedKind: 'wall',
        confidence: 'medium',
      });
    }
  }

  return candidates;
}

function analyzeGLBFile(filePath: string, fileName: string): PropAnalysis {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;

  // For now, we'll do basic file analysis without full GLB parsing
  // In a production version, we'd use @gltf-transform/core to parse the GLB
  // and extract actual node information

  // Basic heuristic: Read file as buffer and look for node name patterns
  const buffer = fs.readFileSync(filePath);
  const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 10000)); // Read first 10KB as text

  // Extract potential node names (this is a simple heuristic)
  const nodeNames: string[] = [];
  const nodePatterns = /\"name\":\"([^\"]+)\"/g;
  let match;
  while ((match = nodePatterns.exec(content)) !== null) {
    nodeNames.push(match[1]);
  }

  const uniqueNodes = [...new Set(nodeNames)];
  const surfaceCandidates = detectSurfaceCandidates(uniqueNodes);

  const needsReview = surfaceCandidates.length > 0;
  const tier: PropAnalysis['tier'] = surfaceCandidates.length > 0 ? 3 : 1;

  const analysis: PropAnalysis = {
    fileName,
    tier,
    fileSize: formatFileSize(fileSize),
    fileSizeBytes: fileSize,
    namedNodes: uniqueNodes,
    surfaceCandidates,
    recommendedAnchor: {
      type: 'bbox',
      align: { x: 'center', y: 'min', z: 'center' },
    },
    needsReview,
  };

  // Auto-configure high-confidence surface candidates
  if (surfaceCandidates.length === 1 && surfaceCandidates[0].confidence === 'high') {
    analysis.autoConfig = {
      surfaces: [
        {
          nodeName: surfaceCandidates[0].nodeName,
          kind: surfaceCandidates[0].suggestedKind,
          normalSide: 'positive',
        },
      ],
    };
  }

  return analysis;
}

function generateMarkdownReport(report: AnalysisReport): string {
  const entries = Object.entries(report);
  const reviewNeeded = entries.filter(([_, a]) => a.needsReview && !a.skipped);
  const simple = entries.filter(([_, a]) => !a.needsReview && !a.skipped);
  const skipped = entries.filter(([_, a]) => a.skipped);

  let md = '# Prop Analysis Report\n\n';
  md += `**Total files:** ${entries.length}\n`;
  md += `**Simple props:** ${simple.length}\n`;
  md += `**Needs review:** ${reviewNeeded.length}\n`;
  md += `**Skipped (approved):** ${skipped.length}\n\n`;

  md += '---\n\n';

  if (skipped.length > 0) {
    md += '## ✅ Skipped (Already Approved)\n\n';
    for (const [fileName, analysis] of skipped) {
      md += `- ${fileName} - ${analysis.skipReason}\n`;
    }
    md += '\n---\n\n';
  }

  if (reviewNeeded.length > 0) {
    md += '## ⚠️ Props Requiring Review\n\n';
    for (const [fileName, analysis] of reviewNeeded) {
      md += `### ${fileName}\n`;
      md += `- **Size:** ${analysis.fileSize}\n`;
      md += `- **Tier:** ${analysis.tier}\n`;
      md += `- **Surface candidates:** ${analysis.surfaceCandidates.length}\n`;

      for (const candidate of analysis.surfaceCandidates) {
        md += `  - \`${candidate.nodeName}\` → ${candidate.suggestedKind} (confidence: ${candidate.confidence})\n`;
      }

      if (analysis.autoConfig) {
        md += `- **Auto-config available:** Yes ✓\n`;
        md += `  - Add to prop-overrides.json: \`"${fileName}": "accept"\`\n`;
      } else {
        md += `- **Auto-config available:** No - needs manual configuration\n`;
      }

      md += '\n';
    }
    md += '---\n\n';
  }

  if (simple.length > 0) {
    md += '## ✓ Simple Props (Auto-configured)\n\n';
    md += 'These props will be automatically added to the catalog:\n\n';
    for (const [fileName, analysis] of simple) {
      md += `- ${fileName} (${analysis.fileSize})\n`;
    }
    md += '\n---\n\n';
  }

  md += '## Next Steps\n\n';
  md += '1. Review props flagged above\n';
  md += '2. Edit `prop-overrides.json` for any customization needed\n';
  md += '3. Run `pnpm props:generate` to create catalog entries\n';

  return md;
}

function main() {
  console.log('🔍 Analyzing props in apps/web/public/models/...\n');

  if (!fs.existsSync(MODELS_DIR)) {
    console.error(`❌ Models directory not found: ${MODELS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.glb'));

  if (files.length === 0) {
    console.log('📭 No .glb files found in models directory');
    console.log('   Add your downloaded props to apps/web/public/models/ and run again');
    process.exit(0);
  }

  console.log(`Found ${files.length} GLB files\n`);

  const report: AnalysisReport = {};

  for (const fileName of files) {
    // Skip approved models
    if (APPROVED_MODELS.includes(fileName)) {
      report[fileName] = {
        fileName,
        tier: 1,
        fileSize: '',
        fileSizeBytes: 0,
        namedNodes: [],
        surfaceCandidates: [],
        recommendedAnchor: {
          type: 'bbox',
          align: { x: 'center', y: 'min', z: 'center' },
        },
        needsReview: false,
        skipped: true,
        skipReason: 'Already in catalog',
      };
      console.log(`⏭️  ${fileName} - skipped (already approved)`);
      continue;
    }

    const filePath = path.join(MODELS_DIR, fileName);
    const analysis = analyzeGLBFile(filePath, fileName);
    report[fileName] = analysis;

    const icon = analysis.needsReview ? '⚠️' : '✓';
    const reviewText = analysis.needsReview ? 'needs review' : 'auto-configured';
    console.log(`${icon}  ${fileName} - ${analysis.fileSize} - ${reviewText}`);

    if (analysis.fileSizeBytes > 100 * 1024) {
      console.log(`   ⚠️  Large file size (>${100}KB) - consider optimization`);
    }
  }

  // Write JSON report
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✅ Analysis complete: ${OUTPUT_FILE}`);

  // Write markdown report
  const mdReport = generateMarkdownReport(report);
  const mdPath = path.join(process.cwd(), 'PROP_ANALYSIS.md');
  fs.writeFileSync(mdPath, mdReport, 'utf-8');
  console.log(`✅ Review report: ${mdPath}`);

  const reviewCount = Object.values(report).filter((a) => a.needsReview).length;
  if (reviewCount > 0) {
    console.log(`\n📋 ${reviewCount} props need review - check PROP_ANALYSIS.md`);
  }
}

main();
