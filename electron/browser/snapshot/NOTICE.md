# NOTICE

Portions of this software are derived from **Agent-Browser**:

- **Project**: Agent-Browser (Vercel Labs)
- **Repository**: https://github.com/vercel-labs/agent-browser
- **Source file**: `cli/src/native/snapshot.rs`
- **License**: Apache License 2.0
- **Copyright**: Copyright 2025 Vercel Inc.

## Ported modules

| File | Source function | Notes |
|------|---------------|-------|
| `treeBuilder.ts` | `build_tree()` | Rust Vec → TypeScript indexed array |
| `refAllocator.ts` | Role constants + `RoleNameTracker` | HashSet → Set, HashMap → Map |
| `cursorDetector.ts` | `find_cursor_interactive_elements()` | JS payload reused, CDP pipeline adapted for Electron |
| `renderer.ts` | `render_tree()` + `compact_tree()` | String → string[], same indent/skip/compact logic |
| `iframeResolver.ts` | `resolve_iframe_frame_id()` | Direct port |

## Original modules (not derived from Agent-Browser)

| File | Notes |
|------|-------|
| `snapshotTypes.ts` | CDP protocol types + OpenCow domain types |
| `snapshotState.ts` | Independent state container |
| `snapshotService.ts` | Orchestrator combining ported + original modules |

## Apache License 2.0

```
Copyright 2025 Vercel Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
