# Nect Japanese font fixtures

Two small, redistributable test fonts derived from Noto Sans CJK JP Regular
2.004. These are deliberately limited test fixtures, not general-purpose
Japanese fonts.

| File                        | Container and outline format                                |         Size |
| --------------------------- | ----------------------------------------------------------- | -----------: |
| `NectJPFixture-Regular.otf` | Standalone OpenType, CFF Type 2 outlines (`OTTO`)           | 27,000 bytes |
| `NectJPFixture-Regular.ttf` | Standalone TrueType, quadratic `glyf` outlines (`00010000`) | 31,372 bytes |

Neither output is a TTC/OTC collection. Both preserve the `vert` and `vrt2`
GSUB features and vertical `vhea`/`vmtx` metrics. The CFF OTF also preserves
`VORG`. The TTF was converted from the subset CFF outlines using fontTools
Cu2QuPen, with a maximum approximation error of 1 font unit at 1000 UPM.

## Coverage

Both fonts include ASCII U+0020–U+007E and these Japanese characters:

`日本語、。ー（）あア縦書き横テストこんにちは世界「」『』【】！？ぁぃぅぇぉゃゅょっァィゥェォャュョッ〈〉《》…　文章ガパヴ麺カ`

There are 158 Unicode cmap entries and 210 glyphs including vertical variants
and `.notdef`. Newlines are layout controls, not glyphs.

## License and naming

The font data, including these derivatives, is under SIL Open Font License
1.1. Ship `OFL.txt` with every copy of either font and keep its copyright
notice. The font must remain under OFL, must not be sold on its own, and the
copyright holders must not be represented as endorsing the modified fixture.

The upstream Noto Sans JP license published by Google Fonts declares the
Reserved Font Name `Source`. These derivatives avoid that name and also
rename the original Noto family, full, unique, and PostScript names to
`Nect JP Fixture` and `Nect JP Fixture TTF`. Original authorship, copyright,
and license metadata are preserved. This README is an implementation note,
not legal advice.

Authoritative references:

- Upstream project: https://github.com/notofonts/noto-cjk
- Version 2.004 release: https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004
- Upstream collection: https://github.com/notofonts/noto-cjk/blob/main/Sans/OTC/NotoSansCJK-Regular.ttc
- Standalone upstream OTF: https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf
- Upstream license: https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE
- Noto Sans JP license and Reserved Font Name: https://github.com/google/fonts/blob/main/ofl/notosansjp/OFL.txt

## Input provenance and reproduction

The actual input bytes came from this environment's existing
`/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`, face index 0. They
were not freshly downloaded. The embedded names identify Noto Sans CJK JP
Regular 2.004. The accompanying installed Debian copyright file points to
the upstream project above. The input's exact SHA-256, byte length, names,
and output hashes are recorded in `manifest.json`; this distinguishes the
local source from the linked upstream release without claiming a byte-for-byte
upstream download comparison.

Regenerate with existing fontTools 4.61.1:

```sh
python build_fixture.py /path/to/NotoSansCJK-Regular.ttc /path/to/output
```

The script only reads that input and writes output files. It does not
download, install, or execute any external software. Generation preserves
the source timestamp to make output deterministic.

## Validation

- fontTools reload succeeded for both files.
- Every advertised Unicode character is present in the cmap.
- Required `vert`, `vrt2`, `vhea`, and `vmtx` tables/features are preserved.
- OpenType.js 1.3.4 parsed both files. Every character in
  `日本語、。ー（）あア` resolved to a nonzero glyph and a nonempty path with
  finite coordinates. The extended regression text
  `「日本。、」ABC12\n（文章）123` and added `文章ガパヴ麺カ` also passed.

These checks establish font parsing and outline availability. Application
layout and SVG-output tests should still verify the chosen `vert`/`vrt2`
substitutions, punctuation positioning, multi-column order, and round-trip
font upload behavior.
