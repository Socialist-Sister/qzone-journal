# Collector process boundary

QQ Space collection will run outside the React renderer.

The collector host now owns:

- a shared persistent Electron session for authenticated network requests;
- rate limiting, retries, checkpoints, and incremental cursors;
- normalization into versioned local records;
- media downloads and integrity checks;
- progress events that contain counts and status only, never raw credentials.

The renderer may request a collection job through a narrow preload API, but it never receives cookies, passwords, or unrestricted filesystem access. The Electron main process validates every destination path and job option before starting an Electron Utility Process. The login window and collector share the same non-persistent per-account Electron session, so raw cookies do not cross the IPC boundary and are cleared after collection completes, fails, or is cancelled.

The current adapter performs a real authenticated session probe and uses the QZone `feeds3_html_more` stream as the primary source for the signed-in user's posts. It paginates with `externparam`, normalizes titleless posts, downloads allow-listed QZone image hosts, preserves a checkpoint after every page, and writes deterministic per-entry records. Embedded comments and visible liker identities are best-effort; their displayed totals may exceed the people expanded in the HTML response.

Album-specific pagination remains deferred because the currently known photo endpoints are materially less reliable. All endpoint-specific behavior stays isolated in `qzone-adapter.cjs` and `qzone-parser.cjs`; archive consumers depend only on the local schema.
