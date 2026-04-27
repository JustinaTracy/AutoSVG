---
name: Silhouette is frozen — do not modify
description: User spent hours fixing silhouette mode. Never change silhouette tracing code again without explicit permission.
type: feedback
---

Do NOT modify how the silhouette works. The user spent many hours getting it working correctly (evenodd + median filter for alpha, edge detection for non-alpha, turdSize 300, optTolerance 2.0). Any changes to simplified or other modes must NOT touch the silhouette code path.

**Why:** Multiple rounds of breaking and fixing silhouette caused frustration. The current implementation is the user-approved version.

**How to apply:** When working on simplified mode or any other feature, read the silhouette output but never modify how it's generated. The simplified mode should consume the silhouette's output, not change how it's produced.
