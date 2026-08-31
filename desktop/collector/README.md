# Collector process boundary

QQ Space collection will run outside the React renderer.

The collector host now owns:

- a shared persistent Electron session for authenticated network requests;
- rate limiting, retries, checkpoints, and incremental cursors;
- normalization into versioned local records;
- media downloads and integrity checks;
- progress events that contain counts and status only, never raw credentials.

The renderer may request a collection job through a narrow preload API, but it never receives cookies, passwords, or unrestricted filesystem access. The Electron main process validates every destination path and job option before starting an Electron Utility Process. The login window and collector share the same non-persistent per-account Electron session, so raw cookies do not cross the IPC boundary and are cleared after collection completes, fails, or is cancelled.

The current adapter performs a real authenticated session probe and reads the signed-in user's Sayings category through `emotion_cgi_msglist_v6`, paginated by numeric offset and the returned total. A first-page `-10000` rate limit may fall back only to the owner-only `scope=1` `feeds3_html_more` timeline; the personal archive path rejects `scope=0` friend activity entirely. It normalizes titleless posts, downloads allow-listed QZone image hosts, preserves a checkpoint after every page, and writes deterministic per-entry records. Embedded comments and visible liker identities are best-effort; their displayed totals may exceed the people expanded in the response.

Album-specific pagination remains deferred because the currently known photo endpoints are materially less reliable. All endpoint-specific behavior stays isolated in `qzone-adapter.cjs` and `qzone-parser.cjs`; archive consumers depend only on the local schema.
