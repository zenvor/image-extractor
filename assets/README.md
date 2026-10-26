# Logo artwork

[`logo-source.svg`](logo-source.svg) is the editable vector source for the Image Extractor logo. It reconstructs the overlapping cards, suns, mountains, and indigo palette of the earlier PNG using named groups, paths, clipping paths, and gradients. It contains no embedded raster image, fonts, or external resources. Open it in an SVG editor such as Inkscape, Figma, or Illustrator to edit the artwork.

[`logo-source.png`](logo-source.png) is retained as the earlier raster reference. The SVG is a reconstruction, not a recovered original design file, so the contours and gradients are not pixel-identical. The earlier PNG's creation method is not documented.

Run from the repository root:

```sh
npm run icons
```

The script renders the SVG with Sharp and writes transparent PNGs to `public/icons/`: `16.png`, `32.png`, `48.png`, `128.png`, and the 256px `mark.png`. All exports share the same artwork and proportional padding. Chrome uses the PNG files; the SVG remains the editable source. The repository READMEs display the SVG directly for sharp scaling.

After editing the source, regenerate and commit the PNGs together with the SVG. Inspect the smallest sizes as well as the full-size artwork. Running this command does not rebuild or reload an installed extension, update an existing release, or change Chrome Web Store assets.

The artwork is covered by the repository's [MIT license](../LICENSE).
