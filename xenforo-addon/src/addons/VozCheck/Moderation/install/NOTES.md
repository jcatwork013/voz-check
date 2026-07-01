# VozCheck/Moderation — Install Notes

This file is a quick operator checklist. The full documentation lives in the
repository root `README.md`.

## Where this directory must live

On a live XenForo instance the add-on must sit at:

```
<xenforo-root>/src/addons/VozCheck/Moderation/
```

i.e. copy the contents of `src/addons/VozCheck/Moderation/` (this folder and its
siblings) into your forum's `src/addons/VozCheck/Moderation/` so that
`addon.json` ends up at `<root>/src/addons/VozCheck/Moderation/addon.json`.

## Install sequence

1. Copy files (see above).
2. AdminCP → **Add-ons** → find **VozCheck AI Moderation** → **Install**.
   - This imports `_data/options.xml`, `_data/option_groups.xml`,
     `_data/code_event_listeners.xml`, `_data/phrases.xml` and runs `Setup.php`
     (which is a no-op — no DB tables).
3. AdminCP → **Setup → Options → VozCheck AI Moderation**:
   - Set **Backend URL** (e.g. `https://voz-check.9bricks.com`).
   - Set **Ingest API key**.
   - Choose **Hide mode** (default: *Hold for approval*).
   - Set **Skip staff** / **Fail closed** as desired.
   - Turn **Enable VozCheck moderation** ON.
4. Rebuild caches if prompted (AdminCP → Tools → Rebuild Caches → Code event
   listeners / Options / Phrases).

## CLI alternative (developer install)

If you develop with the file-based add-on workflow:

```bash
php cmd.php xf:addon-install VozCheck/Moderation
# or, when iterating on the XML data files:
php cmd.php xf-dev:import --addon VozCheck/Moderation
```

## Verifying it runs

- Post a test reply as a normal (non-staff) user containing obviously violating
  content (per your backend's rules). Expect it to be held for approval (or
  soft-deleted, per Hide mode) and an alert to be delivered.
- Check **AdminCP → Logs → Server error log** for `VozCheck ...` entries if
  nothing happens — misconfiguration and backend errors are logged there.
