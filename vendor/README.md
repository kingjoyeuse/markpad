# Offline editor dependency snapshot

Extracted from the already delivered Markpad 0.1.0 renderer bundle, without app code.
This retains the exact Tiptap 3.33.0 / ProseMirror dependencies when npm is unavailable.
`build.mjs` normally uses the pinned npm dependencies. `build-offline.mjs` combines
this snapshot with the current, unminified source modules. It never loads a remote script.
The snapshot exports only editor dependencies, not old application implementations.
After a dependency upgrade, regenerate this dependency-only snapshot from those pinned packages and verify worker/editor schema compatibility. A normal source build does not regenerate the snapshot.
Copyright/license ownership remains with the component authors listed in THIRD_PARTY_NOTICES.md.

This update additionally exposes the already bundled, public `closeHistory` helper
from the exact same pinned ProseMirror history module (no dependency upgrade).
It gives linked insertions a separate undo boundary from subsequent typing.
The snapshot also exposes Tiptap's public `Node` class so the renderer and
formatting worker can share the embedded HTML node definitions.
