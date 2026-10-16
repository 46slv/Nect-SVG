#!/usr/bin/env python3
"""Build tiny Japanese fixtures from an already-installed Noto Sans CJK JP.

Requires fontTools. No download, installation, or network access is performed.
Run: python build_fixture.py [NotoSansCJK-Regular.ttc] [output-directory]
"""
import hashlib
import json
import sys
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
DEST = Path(sys.argv[2] if len(sys.argv) > 2 else __file__).resolve()
if len(sys.argv) <= 2:
    DEST = DEST.parent
DEST.mkdir(parents=True, exist_ok=True)
REQUIRED = '日本語、。ー（）あア'
EXTRA = '縦書き横テストこんにちは世界「」『』【】！？ぁぃぅぇぉゃゅょっァィゥェォャュョッ〈〉《》…　文章ガパヴ麺カ'
TEXT = ''.join(chr(i) for i in range(32, 127)) + REQUIRED + EXTRA
FAMILY = 'Nect JP Fixture'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rename(font, family):
    postscript = family.replace(' ', '') + '-Regular'
    replace = {1: family, 2: 'Regular', 3: '1.000;' + postscript,
               4: family + ' Regular', 5: 'Version 1.000; Nect test subset of Noto Sans CJK JP 2.004',
               6: postscript, 16: family, 17: 'Regular', 18: family + ' Regular',
               21: family, 22: 'Regular'}
    for record in font['name'].names:
        if record.nameID in replace:
            record.string = replace[record.nameID]
    for name_id, value in replace.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
    if 'CFF ' in font:
        cff = font['CFF '].cff
        cff.fontNames[0] = postscript
        top = cff.topDictIndex[0]
        top.FamilyName = family
        top.FullName = family + ' Regular'
        if hasattr(top, 'FontName'):
            top.FontName = postscript
        if hasattr(top, 'FDArray'):
            for i, fd in enumerate(top.FDArray):
                if hasattr(fd, 'FontName'):
                    fd.FontName = postscript + '-FD' + str(i)


font = TTFont(SOURCE, fontNumber=0, recalcTimestamp=False)
original_names = {str(n): font['name'].getDebugName(n) for n in (0, 1, 3, 5, 6, 13, 14)}
assert original_names['1'] == 'Noto Sans CJK JP', 'Input face 0 must be Noto Sans CJK JP'
assert 'CFF ' in font and font.sfntVersion == 'OTTO'
options = subset.Options()
options.layout_features = ['vert', 'vrt2']
options.name_IDs = ['*']
options.name_languages = ['*']
options.name_legacy = True
options.notdef_glyph = True
options.notdef_outline = True
options.glyph_names = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=TEXT)
subsetter.subset(font)
rename(font, FAMILY)
otf_path = DEST / 'NectJPFixture-Regular.otf'
font.save(otf_path)

# A second fixture exercises real quadratic TrueType/glyf parsing. Curves are
# converted from the subset's CFF outlines at <= 1 unit error (1000 UPM).
ttf = TTFont(otf_path, recalcTimestamp=False)
glyph_set = ttf.getGlyphSet()
glyphs = {}
for glyph_name in ttf.getGlyphOrder():
    pen = TTGlyphPen(None)
    glyph_set[glyph_name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
    glyphs[glyph_name] = pen.glyph()
del ttf['CFF ']
if 'VORG' in ttf:
    del ttf['VORG']
del ttf['maxp']
ttf.sfntVersion = '\x00\x01\x00\x00'
builder = FontBuilder(font=ttf)
builder.isTTF = True
builder.setupGlyf(glyphs)
builder.setupMaxp()
builder.setupPost(keepGlyphNames=True)
rename(ttf, FAMILY + ' TTF')
ttf_path = DEST / 'NectJPFixture-Regular.ttf'
ttf.save(ttf_path)

artifacts = []
for path in (otf_path, ttf_path):
    checked = TTFont(path, recalcTimestamp=False)
    cmap = checked.getBestCmap()
    assert all(ord(c) in cmap for c in TEXT)
    features = sorted({r.FeatureTag for r in checked['GSUB'].table.FeatureList.FeatureRecord})
    assert 'vert' in features and 'vrt2' in features
    assert 'vmtx' in checked and 'vhea' in checked
    artifacts.append({'file': path.name, 'bytes': path.stat().st_size,
                      'sha256': sha256(path), 'magic_hex': path.read_bytes()[:4].hex(),
                      'outline_format': 'CFF' if 'CFF ' in checked else 'TrueType glyf',
                      'glyph_count': len(checked.getGlyphOrder()),
                      'cmap_count': len(cmap), 'gsub_features': features,
                      'tables': [str(t) for t in checked.keys()],
                      'family': checked['name'].getDebugName(1)})

manifest = {
    'license': 'SIL Open Font License 1.1',
    'fonttools_version': fontTools.__version__,
    'source_path_used': str(SOURCE),
    'source_bytes': SOURCE.stat().st_size,
    'source_sha256': sha256(SOURCE),
    'source_face_index': 0,
    'source_names': original_names,
    'upstream_repository': 'https://github.com/notofonts/noto-cjk',
    'upstream_release': 'https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004',
    'upstream_collection': 'https://github.com/notofonts/noto-cjk/blob/main/Sans/OTC/NotoSansCJK-Regular.ttc',
    'upstream_otf': 'https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
    'upstream_license': 'https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE',
    'required_text': REQUIRED,
    'extra_text': EXTRA,
    'ascii_range': 'U+0020-U+007E',
    'artifacts': artifacts,
}
(DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(artifacts, ensure_ascii=False, indent=2))
