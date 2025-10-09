# Documentation Index

## Quick Start

- **[CLAUDE.md](../CLAUDE.md)** - Main project guide with architecture overview and development commands
- **[camera-system-technical-guide.md](./camera-system-technical-guide.md)** - ⭐ **START HERE** for camera system work

## Camera System Documentation

### Primary Documentation
- **[camera-system-technical-guide.md](./camera-system-technical-guide.md)** (October 2025)
  - **Complete technical reference** for implemented camera system
  - Desk-relative alignment mechanics
  - Dynamic clamp system for screen view
  - Spherical coordinate explanations
  - Data flow diagrams
  - Troubleshooting guide
  - **Use this for understanding current implementation**

### Historical/Planning Documents
- **[camera-reform-plan.md](./camera-reform-plan.md)** - Original v1.0 refactor plan (mostly implemented)
- **[Plan camera-first desk align.txt](./Plan%20camera-first%20desk%20align.txt)** - Layout frame system design (implemented)

## Layout & Props
- **[prop-alignment-plan.md](./prop-alignment-plan.md)** - Prop placement and alignment strategies

---

## When to Use Which Document

### "I need to understand how the camera works"
→ Read **camera-system-technical-guide.md**

### "I need to modify camera behavior"
→ Read **camera-system-technical-guide.md** sections:
- "View Configurations" (for clamp adjustments)
- "Desk-Relative Camera Alignment" (for alignment logic)
- "Dynamic Clamp System" (for screen view constraints)

### "The camera isn't aligning with the desk"
→ Read **camera-system-technical-guide.md** section:
- "Troubleshooting Guide" → "Camera Doesn't Align with Desk Forward Vector"

### "I want to add a new camera view"
→ Read **camera-system-technical-guide.md** section:
- "Future Enhancements" → "Multiple Saved Camera Positions"

### "I need high-level architecture overview"
→ Read **CLAUDE.md** section:
- "Architecture Overview" → "4. Camera System"

---

## Document Status

| Document | Status | Last Updated | Purpose |
|----------|--------|--------------|---------|
| camera-system-technical-guide.md | ✅ Current | Oct 2025 | Technical reference for implemented system |
| camera-reform-plan.md | 📦 Archive | Earlier | Original refactor plan (mostly complete) |
| Plan camera-first desk align.txt | 📦 Archive | Earlier | Layout frame design (implemented) |
| prop-alignment-plan.md | ✅ Current | Oct 2024 | Prop placement strategies |

---

## Quick Answers

**Q: Why is camera yaw always ~90°?**
A: The desk's forward vector points in -X direction. Camera is positioned opposite (in front of desk where user sits), which places it on +X axis = 90° yaw. See "Desk-Relative Camera Alignment" in technical guide.

**Q: Why does screen view have full 360° yaw?**
A: It doesn't—it has *dynamic* ±30° clamps centered around the calculated monitor-facing direction. The static config shows full range because clamps are applied dynamically in `CameraRigController`. See "Dynamic Clamp System" in technical guide.

**Q: What's the difference between yaw and azimuth?**
A: They're the same thing. "Yaw" is used in our code, "azimuth" is used by the `camera-controls` library. Both mean horizontal rotation angle around the Y-axis.

**Q: Why can't I just set yaw to 0° to align with desk?**
A: Because yaw is calculated from the desk's forward vector, which varies based on desk rotation. The calculation *produces* the correct yaw (typically 90° for standard desk orientation). Setting a fixed yaw wouldn't follow desk rotation. See "Desk-Relative Camera Alignment" in technical guide.
