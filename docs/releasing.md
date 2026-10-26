# Publishing release assets

Release titles and notes are written manually. The workflow only builds and uploads assets to an existing published GitHub Release; it never creates releases, tags, titles or release notes, and does not submit updates to the Chrome Web Store.

## Prepare the source

1. Set the intended version in `package.json`, `package-lock.json` and the lockfile's root package entry. Record the version in release notes and `CHROMEWEBSTORE.md`. READMEs link to `releases/latest` and describe package names without a fixed release number; keep release-specific versions, store-review status and validation records in their dedicated documents.
2. Complete the relevant Chrome checks in [release-smoke.md](release-smoke.md).
3. Commit and merge the release changes, including `.github/workflows/release.yml`, before creating the release tag. The tag must point to the prepared source commit, not an older version.

## Create and publish a release manually

1. Open the repository's **Releases** page and select **Draft a new release**.
2. Enter a new tag such as `v1.0.0` (or `1.0.0`), select the prepared commit/branch, and choose **Create new tag on publish**.
3. Write the release title and notes manually. Do not select automatically generated release notes unless you explicitly want to use them yourself.
4. Publish the release. Saving a draft or pushing a tag alone does not trigger the workflow.
5. Wait for **Build release assets** to succeed. The release's **Assets** section will receive:
   - `image-extractor-1.0.0-chrome.zip`
   - `image-extractor-1.0.0-chrome.zip.sha256`

The workflow checks out the released commit, verifies the tag against both source version files, installs locked dependencies, runs type checking and the full test suite, builds the extension, checks the production bundle, and verifies the ZIP before uploading. A mismatch fails the job instead of silently changing the source version. Both stable and published pre-releases trigger the workflow, but the tag must still use the numeric version above; prerelease suffixes are not accepted as Chrome manifest versions.

## Write release notes

Write the English release body in `docs/releases/<version>.md` and add a short entry to [release-notes.md](release-notes.md). Use that same authored body on GitHub so the repository and release page agree.

Start with the outcome users gain. Group real changes under a few descriptive headings, give concise first-use or update instructions, and link the version's extension ZIP and checksum. Include meaningful compatibility limits and relevant credits. For later releases, add a comparison link to the previous release.

Keep test logs, local paths, build internals and historical investigation notes in the verification documents. Describe only features included in the tagged package; a later documentation edit does not change a published binary. When editing an existing release, update its notes without moving its tag or replacing its assets.

## Release assets

The ZIP contains `manifest.json` at its root, the built extension files, the project MIT license and bundled third-party notices. Source code, tests, dependencies and credentials are not packaged. The checksum file contains the ZIP filename for use with `sha256sum -c`.

If building or uploading fails, fix the cause and rerun the failed workflow where appropriate. Reruns replace assets with the same filenames; they do not edit release notes. The repository's release immutability setting was verified disabled on 2026-10-25, allowing this publish-first attachment flow. The workflow uses GitHub's built-in token; no additional publishing secret is required.

## Local packaging

After a verified build:

```sh
python3 scripts/package-release.py
```

For an isolated candidate build, pass `--build-dir` and optionally `--output-dir`. Packaging validates the built manifest and lockfile, includes license files, verifies ZIP integrity, and writes a SHA-256 file. It does not build, publish or reload Chrome by itself.
