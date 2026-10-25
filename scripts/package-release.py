"""Package only the built extension and its license for a manually authored release."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package_release(build_dir: Path, output_dir: Path) -> Path:
    root = Path(__file__).resolve().parent.parent
    package = json.loads((root / "package.json").read_text())
    lock = json.loads((root / "package-lock.json").read_text())
    version = package["version"]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Expected a numeric Chrome release version")
    parts = [int(part) for part in version.split(".")]
    if max(parts) > 65535 or not any(parts):
        raise ValueError("Version is outside Chrome's supported range")
    if lock["version"] != version or lock["packages"][""]["version"] != version:
        raise ValueError("package-lock.json does not match package.json")

    manifest = json.loads((build_dir / "manifest.json").read_text())
    if manifest["version"] != version or manifest["manifest_version"] != 3:
        raise ValueError("Build a matching Manifest V3 extension before packaging")
    for required in ["background.js", "popup.html", "download.html", "tools.html",
                     "THIRD_PARTY_LICENSES.md", "THIRD_PARTY_NOTICES.md"]:
        if not (build_dir / required).is_file():
            raise ValueError(f"Missing built file: {required}")

    files = []
    for path in sorted(build_dir.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink in build: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(build_dir)
        if any(part.startswith(".") or part in {"node_modules", "tests", "__tests__"}
               for part in relative.parts) or path.suffix == ".map":
            raise ValueError(f"Unexpected development file in build: {relative}")
        files.append((relative.as_posix(), path))
    if any(name == "LICENSE" for name, _ in files):
        raise ValueError("Root LICENSE is added separately; remove the duplicate build entry")
    files.append(("LICENSE", root / "LICENSE"))

    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"image-extractor-{version}-chrome.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as output:
        for name, source in files:
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = ZIP_DEFLATED
            output.writestr(info, source.read_bytes())
    with ZipFile(archive) as output:
        if output.testzip() is not None:
            raise ValueError("ZIP integrity check failed")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n")
    print(f"Packaged {archive} ({len(files)} files); SHA-256: {digest}")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path, default=Path(".output/chrome-mv3"))
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    args = parser.parse_args()
    package_release(args.build_dir, args.output_dir)
