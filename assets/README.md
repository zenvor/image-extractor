# Logo artwork

[`logo-source.svg`](logo-source.svg) is the single editable source for the Image Extractor logo. It uses named groups, paths, clipping paths, and gradients. It contains no embedded raster image, fonts, or external resources. Open it in an SVG editor such as Inkscape, Figma, or Illustrator to edit the artwork.

The SVG reconstructs the earlier raster design. Its contours and gradients differ slightly; the earlier PNG source has been removed so that all current branding uses this vector artwork.

Run from the repository root:

```sh
npm run icons
```

The script copies the SVG to `public/icons/mark.svg` for the extension interface and renders transparent PNGs with Sharp: `16.png`, `32.png`, `48.png`, `128.png`, and the 256px `mark.png`. All PNG exports share the same artwork and proportional padding. Chrome's manifest uses the required PNG files. The repository READMEs and extension interface display SVG directly for sharp scaling.

After editing the source, regenerate and commit the PNGs together with the SVG. Inspect the smallest sizes as well as the full-size artwork. Running this command does not rebuild or reload an installed extension, update an existing release, or change submitted Chrome Web Store assets.

The same command regenerates `docs/store-assets/promo-440x280.svg` and its PNG export from this artwork. Use the SVG for scalable display and the PNG when uploading to the Store. Refresh interface screenshots from a candidate build after changing the logo.

The artwork is covered by the repository's [MIT license](../LICENSE).
