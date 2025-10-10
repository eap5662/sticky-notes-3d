# Sticky3D Documentation

Welcome to the Sticky3D documentation! This folder contains technical guides and workflows for working with the project.

## Documentation Index

### 🎥 Camera System
- **[Camera System Technical Guide](./camera-system-technical-guide.md)** - Complete architecture of the camera system, including desk-relative alignment, dynamic clamps, spherical coordinates, and troubleshooting

### 📦 Prop Management
- **[Prop Onboarding Guide](./prop-onboarding-guide.md)** - How to add 20-40 props quickly using the automated onboarding system

### 📋 Planning Documents
- **[Plan camera-first desk align.txt](./Plan%20camera-first%20desk%20align.txt)** - Original 6-step plan for layout system (implemented)
- **[prop-alignment-plan.md](./prop-alignment-plan.md)** - High-level goals and proposed workflow for prop system

---

## Quick Links

**For implementing camera features:**
→ See [Camera System Technical Guide](./camera-system-technical-guide.md)

**For adding new props:**
→ See [Prop Onboarding Guide](./prop-onboarding-guide.md)

**For understanding the codebase:**
→ See [CLAUDE.md](../CLAUDE.md) in the root directory

**For recent changes:**
→ See [SPRINT_SUMMARY.md](../SPRINT_SUMMARY.md) in the root directory

---

## Documentation Standards

### When to Update Docs

**Camera System Technical Guide:**
- Camera alignment algorithm changes
- New view modes added
- Clamp calculation changes
- New camera-related bugs discovered

**Prop Onboarding Guide:**
- New prop processing features
- Changed workflow steps
- New override options
- Additional prop requirements

### Writing Style

- Use clear, concise language
- Include code examples
- Provide troubleshooting sections
- Link to related files with line numbers where applicable
- Use emojis sparingly for section markers only

---

## Contributing to Docs

When adding new documentation:

1. Add the file to this `docs/` directory
2. Update this README.md with a link to the new doc
3. Use markdown format (.md)
4. Include a "Last Updated" date at the top
5. Add a table of contents for docs > 200 lines
