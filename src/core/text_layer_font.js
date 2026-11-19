/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { BBOX_INIT, makeMap, Util } from "../shared/util.js";
import { createCmapTable, createNameTable, createPostTable } from "./fonts.js";
import { DataBuilder } from "./data_builder.js";
import { OpenTypeFileBuilder } from "./opentype_file_builder.js";

const UNITS_PER_EM = 2048;
const KERNING_KEY_FACTOR = 0x110000;
// The length of a version 0 kern subtable is a uint16.
const MAX_KERNING_PAIRS = Math.floor((0xffff - 14) / 6);
const KERNING_STEP = 5;
const MIN_KERNING_SHARE = 0.8;
const MAX_KERNING_VALUES_PER_PAIR = 8;
// A single small negative adjustment can be kerning in a sparsely used font.
const MAX_SINGLE_KERNING = 200;
// Bound the fonts retained for each PDF font. Large CJK fonts are usually
// better served by the glyph subset on the current page.
const MAX_CACHED_FONTS = 4;
const MAX_CACHED_CHARACTERS = 256;

// The advances are in 1/1000 em.
const DEFAULT_ASCENT = 0.8;
const DEFAULT_SPACE_ADVANCE = 250;
// The largest advance fitting in the hmtx or vmtx table.
const MAX_ADVANCE = (0xffff * 1000) / UNITS_PER_EM;
// The browsers give no advance to these characters.
const ZERO_WIDTH_REGEXP = /^[\p{Mn}\p{Default_Ignorable_Code_Point}]+$/u;
const RTL_REGEXP = /[\p{sc=Arab}\p{sc=Hebr}\p{sc=Syrc}\p{sc=Thaa}\p{sc=Nkoo}]/u;
const SHAPING_REGEXP = /[\p{M}\p{Default_Ignorable_Code_Point}\p{sc=Hangul}]/u;
const LTR_KERNING_REGEXP =
  /[\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Common}\p{sc=Inherited}]/u;
// The browser shapes Thai and Lao SARA AM as a mark followed by SARA AA.
const SARA_AM_DECOMPOSITIONS = new Map([
  [0x0e33, [0x0e4d, 0x0e32]],
  [0x0eb3, [0x0ecd, 0x0eb2]],
]);
// For debugging, the glyphs can be their boxes, in font units.
const DEBUG_STROKE_WIDTH = 80;
// Two contours of four on-curve points each, all with 16-bit deltas.
const BOX_GLYPH_SIZE = 56;
const BOX_POINT_FLAGS = new Uint8Array(8).fill(1);

let nameTable;
let postTable;
const fontCache = new WeakMap();

function toFontUnits(advance) {
  return Math.round((advance * UNITS_PER_EM) / 1000);
}

function roundFontAdvance(advance) {
  return (toFontUnits(advance) * 1000) / UNITS_PER_EM;
}

function isZeroWidth(text) {
  return ZERO_WIDTH_REGEXP.test(text);
}

function getKerningKey(left, right) {
  return left * KERNING_KEY_FACTOR + right;
}

function getShapedCodePoints(text) {
  const codePoints = [];
  for (const char of text) {
    if (!isZeroWidth(char)) {
      const codePoint = char.codePointAt(0);
      codePoints.push(SARA_AM_DECOMPOSITIONS.get(codePoint)?.[1] ?? codePoint);
    }
  }
  return codePoints;
}

function createStats() {
  return {
    advances: new Map(),
    ligatures: new Map(),
    kerning: new Map(),
    spaceGaps: [],
  };
}

/**
 * @param {Font} font
 * @returns {number} The fraction of the em above the baseline.
 */
function getAscentRatio({ ascent, descent, bbox, fontMatrix, isType3Font }) {
  const isValid = ratio => ratio > 0.5 && ratio < 0.95;
  // The descent sometimes has the wrong sign.
  const ratio = ascent / (ascent + Math.abs(descent));
  if (isValid(ratio)) {
    return ratio;
  }
  if (!bbox) {
    return DEFAULT_ASCENT;
  }
  if (isType3Font && fontMatrix) {
    // The glyph space of Type3 fonts may be flipped.
    const bounds = BBOX_INIT.slice();
    Util.axialAlignedBoundingBox(bbox, fontMatrix, bounds);
    bbox = bounds;
  }
  const [, yMin, , yMax] = bbox;
  const height = yMax - yMin;
  if (!(height > 0 && Number.isFinite(height))) {
    return DEFAULT_ASCENT;
  }
  const bboxRatio = yMax / height;
  // Type 3 glyphs can be arbitrary drawings, with the baseline at either
  // edge of their box. Keep that baseline when it lies within the bounds.
  if (isType3Font && yMin <= 0 && yMax >= 0) {
    return bboxRatio;
  }
  return isValid(bboxRatio) ? bboxRatio : DEFAULT_ASCENT;
}

/**
 * @param {Map} samples - Advance counts by character or ligature.
 * @param {number|string} key
 * @param {number} advance
 * @param {number} [count]
 * @returns {Map<number, number>} Updated counts for the key.
 */
function addCount(samples, key, advance, count = 1) {
  const counts = samples.getOrInsertComputed(key, makeMap);
  return counts.set(advance, (counts.get(advance) || 0) + count);
}

/**
 * @param {Map<number, number>} counts - Count by value.
 * @returns {number} The most frequent value.
 */
function getMostFrequent(counts) {
  let best = NaN,
    bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function addKerningSample(samples, key, advance, count = 1) {
  if (samples.get(key) === null || !Number.isFinite(advance)) {
    return;
  }
  const value = Math.round(advance / KERNING_STEP) * KERNING_STEP;
  const counts = addCount(samples, key, value, count);
  if (counts.size > MAX_KERNING_VALUES_PER_PAIR) {
    samples.set(key, null);
  }
}

function selectKerningPairs(
  samples,
  ligaturePairs,
  maxPairs = MAX_KERNING_PAIRS
) {
  const candidates = [];
  for (const [key, counts] of samples) {
    if (!counts) {
      continue;
    }
    const value = getMostFrequent(counts);
    const count = counts.get(value);
    if (
      value &&
      Math.abs(value) <= 1000 &&
      (count >= 2 ||
        (value < 0 && value >= -MAX_SINGLE_KERNING) ||
        ligaturePairs?.has(key)) &&
      count >= MIN_KERNING_SHARE * counts.values().reduce((a, b) => a + b, 0)
    ) {
      candidates.push({ key, value, count });
    }
  }
  if (candidates.length > maxPairs) {
    candidates.sort((a, b) => b.count - a.count);
    candidates.length = maxPairs;
  }
  return new Map(
    candidates.map(({ key, value }) => [key, roundFontAdvance(value)])
  );
}

function getAdvances(stats) {
  const advances = new Map();
  for (const [codePoint, counts] of stats.advances) {
    let advance = getMostFrequent(counts);
    if (advance === 0 && counts.size > 1) {
      // A nonzero glyph can be scaled to either width.
      advance = counts.keys().find(width => width > 0) ?? 0;
    }
    advances.set(codePoint, advance);
  }
  // A character only drawn in ligatures gets what the others leave.
  for (const [unicode, counts] of stats.ligatures) {
    let known = 0;
    const missing = [];
    for (const char of unicode) {
      const codePoint = char.codePointAt(0);
      const advance = advances.get(codePoint);
      if (advance === undefined) {
        missing.push(codePoint);
      } else {
        known += advance;
      }
    }
    if (!missing.length) {
      continue;
    }
    const advance =
      Math.max(getMostFrequent(counts) - known, 0) / missing.length;
    for (const codePoint of missing) {
      advances.set(codePoint, advance);
    }
  }
  for (const [codePoint, [mark, base]] of SARA_AM_DECOMPOSITIONS) {
    const advance = advances.get(codePoint);
    if (advance !== undefined) {
      advances.getOrInsert(mark, 0);
      advances.getOrInsert(base, advance);
    }
  }
  // Without a space glyph, e.g. with TeX fonts, a space gets the median gap.
  if (!advances.has(0x20)) {
    const gaps = stats.spaceGaps.sort((a, b) => a - b);
    advances.set(0x20, gaps[gaps.length >> 1] ?? DEFAULT_SPACE_ADVANCE);
  }
  return advances;
}

function getKerning(stats, advances, font) {
  if (font.vertical) {
    // Keep vkrn in a single GPOS subtable even if every pair has a
    // different first glyph (ten bytes per pair).
    return selectKerningPairs(
      stats.kerning,
      null,
      Math.floor((0xffff - 14) / 10)
    );
  }
  if (!stats.ligatures.size) {
    return selectKerningPairs(stats.kerning);
  }
  // A ligature's remaining advance is distributed over its internal
  // pairs. Count those observations together with the gaps in the PDF.
  const samples = new Map(stats.kerning);
  const ligaturePairs = new Set();
  for (const [unicode, counts] of stats.ligatures) {
    if (RTL_REGEXP.test(unicode)) {
      continue;
    }
    const codePoints = getShapedCodePoints(unicode);
    const width = codePoints.reduce(
      (sum, codePoint) => sum + advances.get(codePoint),
      0
    );
    const advance = getMostFrequent(counts);
    const value = (advance - width) / (codePoints.length - 1);
    const frequency = counts.get(advance);
    for (let i = 1; i < codePoints.length; i++) {
      const key = getKerningKey(codePoints[i - 1], codePoints[i]);
      const observed = stats.kerning.get(key);
      if (observed && !ligaturePairs.has(key)) {
        samples.set(key, new Map(observed));
      }
      ligaturePairs.add(key);
      addKerningSample(samples, key, value, frequency);
    }
  }
  return selectKerningPairs(samples, ligaturePairs);
}

function countMissingAdvances(advances, cachedAdvances, advanceScale) {
  let missing = 0;
  for (const [codePoint, advance] of advances) {
    if (!(advance >= 0 && advance / advanceScale <= MAX_ADVANCE)) {
      return -1;
    }
    const cachedAdvance = cachedAdvances.get(codePoint);
    if (cachedAdvance === undefined) {
      missing++;
    } else if (
      toFontUnits(cachedAdvance / advanceScale) !==
      toFontUnits(advance / advanceScale)
    ) {
      return -1;
    }
  }
  return missing;
}

function pairCoveredBy(key, advances) {
  return (
    advances.has(Math.floor(key / KERNING_KEY_FACTOR)) &&
    advances.has(key % KERNING_KEY_FACTOR)
  );
}

function equalKerningOnPage(kerning, cachedKerning, advances) {
  return (
    kerning
      .entries()
      .every(([key, value]) => cachedKerning.get(key) === value) &&
    cachedKerning
      .entries()
      .every(
        ([key, value]) =>
          !pairCoveredBy(key, advances) || kerning.get(key) === value
      )
  );
}

function writeBoxGlyph(glyf, width, yMin, yMax) {
  const xMax = Math.min(width, 0x7fff);
  const inset = Math.min(
    DEBUG_STROKE_WIDTH,
    Math.floor(Math.min(xMax, yMax - yMin) / 4)
  );
  if (!inset) {
    return;
  }
  glyf.setInt16(2); // numberOfContours
  glyf.skip(2); // xMin
  glyf.setInt16(yMin);
  glyf.setInt16(xMax);
  glyf.setInt16(yMax);
  glyf.setInt16(3); // endPtsOfContours
  glyf.setInt16(7);
  glyf.skip(2); // instructionLength
  glyf.setArray(BOX_POINT_FLAGS);

  // TrueType stores all x deltas before the y deltas. Wind the inner
  // contour in the opposite direction to leave the middle of the box empty.
  const right = xMax - inset,
    bottom = yMin + inset,
    top = yMax - inset;
  for (const coordinates of [
    [0, 0, xMax, xMax, inset, right, right, inset],
    [yMin, yMax, yMax, yMin, bottom, bottom, top, top],
  ]) {
    let previous = 0;
    for (const coordinate of coordinates) {
      glyf.setInt16(coordinate - previous);
      previous = coordinate;
    }
  }
}

function supportsKerningPositioning(advances) {
  return advances
    .keys()
    .every(codePoint =>
      LTR_KERNING_REGEXP.test(String.fromCodePoint(codePoint))
    );
}

function createKerningPositioning(pairs, vertical) {
  const pairSets = Map.groupBy(pairs, ([left]) => left);
  const count = pairSets.size;
  const coverageOffset = 10 + 2 * count;
  const pairSetsOffset = coverageOffset + 4 + 2 * count;
  const pairPosLength = pairSetsOffset + 2 * count + 4 * pairs.length;
  if (pairPosLength > 0xffff) {
    return null;
  }

  const scriptList = 10;
  const featureList = scriptList + 20;
  const lookupList = featureList + 14;
  const lookup = lookupList + 4;
  const pairPos = lookup + 8;
  const data = new Uint8Array(pairPos + pairPosLength);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x00010000); // version 1.0
  view.setUint16(4, scriptList);
  view.setUint16(6, featureList);
  view.setUint16(8, lookupList);

  // The default script and language select the first feature.
  view.setUint16(scriptList, 1);
  view.setUint32(scriptList + 2, 0x44464c54); // DFLT
  view.setUint16(scriptList + 6, 8); // Script offset
  view.setUint16(scriptList + 8, 4); // DefaultLangSys offset
  view.setUint16(scriptList + 14, 0xffff); // No required feature.
  view.setUint16(scriptList + 16, 1); // Feature count

  view.setUint16(featureList, 1);
  view.setUint32(featureList + 2, vertical ? 0x766b726e : 0x6b65726e); // vkrn or kern
  view.setUint16(featureList + 6, 8); // Feature offset
  view.setUint16(featureList + 10, 1); // Lookup count

  view.setUint16(lookupList, 1);
  view.setUint16(lookupList + 2, 4); // Lookup offset
  view.setUint16(lookup, 2); // Pair adjustment
  view.setUint16(lookup + 2, 0x0008); // Ignore marks.
  view.setUint16(lookup + 4, 1); // Subtable count
  view.setUint16(lookup + 6, 8); // First subtable offset

  // Adjust the full advance of the first glyph. This keeps the selection
  // boundary at the start of the second glyph.
  view.setUint16(pairPos, 1); // Pair positioning format 1
  view.setUint16(pairPos + 2, coverageOffset);
  view.setUint16(pairPos + 4, vertical ? 8 : 4); // yAdvance or xAdvance
  view.setUint16(pairPos + 8, count);
  const coverage = pairPos + coverageOffset;
  view.setUint16(coverage, 1); // Coverage format 1
  view.setUint16(coverage + 2, count);

  let index = 0,
    offset = pairPos + pairSetsOffset;
  for (const [left, records] of pairSets) {
    view.setUint16(coverage + 4 + 2 * index, left);
    view.setUint16(pairPos + 10 + 2 * index++, offset - pairPos);
    view.setUint16(offset, records.length);
    offset += 2;
    for (const [, right, units] of records) {
      view.setUint16(offset, right);
      view.setInt16(offset + 2, units);
      offset += 4;
    }
  }
  return data;
}

function addKerningTable(
  builder,
  pairs,
  charCodeToGlyphId,
  advances,
  vertical
) {
  for (const pair of pairs) {
    pair[0] = charCodeToGlyphId.get(pair[0]);
    pair[1] = charCodeToGlyphId.get(pair[1]);
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // The legacy kern table uses visual order, which also works for RTL.
  // GPOS pairs are in reading order for LTR text and upright columns.
  if (vertical || supportsKerningPositioning(advances)) {
    const gpos = createKerningPositioning(pairs, vertical);
    if (gpos) {
      builder.addTable("GPOS", gpos);
      return;
    }
  }
  const count = pairs.length;
  const data = new Uint8Array(18 + 6 * count);
  const kern = new DataView(data.buffer);
  kern.setUint16(2, 1); // nTables
  kern.setUint16(6, 14 + 6 * count); // subtable length
  kern.setUint16(8, vertical ? 0 : 1); // format 0, writing direction
  kern.setUint16(10, count);
  const { range, entry, rangeShift } = OpenTypeFileBuilder.getSearchParams(
    count,
    6
  );
  kern.setUint16(12, range);
  kern.setUint16(14, entry);
  kern.setUint16(16, rangeShift);
  let offset = 18;
  for (const [left, right, units] of pairs) {
    kern.setUint16(offset, left);
    kern.setUint16(offset + 2, right);
    kern.setInt16(offset + 4, units);
    offset += 6;
  }
  builder.addTable("kern", data);
}

/**
 * Build a TrueType font, with empty glyphs, for the text layer.
 * @param {Map<number, number>} advances - Advance by code point.
 * @param {number} ascent - Fraction of the em; the descent is the rest.
 * @param {boolean} [drawBoxes] - Debug: draw glyph bounds.
 * @param {Map<number, number>} [kerning] - Advances by Unicode pair key.
 * @param {boolean} [vertical] - Use vertical advances for upright glyphs.
 * @param {number} [advanceScale] - PDF advance per unit of encoded advance.
 * @returns {Uint8Array|null} The font, or null if the advances don't fit.
 */
function buildTextLayerFont(
  advances,
  ascent,
  drawBoxes = false,
  kerning,
  vertical = false,
  advanceScale = 1
) {
  const kerned = new Set();
  const pairs = [];
  for (const [key, advance] of kerning || []) {
    const left = Math.floor(key / KERNING_KEY_FACTOR);
    const right = key % KERNING_KEY_FACTOR;
    const units = toFontUnits(advance / advanceScale);
    if (units && advances.has(left) && advances.has(right)) {
      kerned.add(left).add(right);
      pairs.push([left, right, units]);
    }
  }

  // Glyph 0 is .notdef. Unkerned characters with the same advance can share
  // a glyph. The kern table identifies a pair by glyph IDs, not code points.
  const glyphAdvances = [0];
  const glyphIdByWidth = new Map();
  const charCodeToGlyphId = new Map();
  let advanceSum = 0,
    advanceMax = 0,
    firstChar = 0xffff,
    lastChar = 0;
  for (const [codePoint, advance] of advances) {
    if (!(advance >= 0 && advance / advanceScale <= MAX_ADVANCE)) {
      return null;
    }
    const units = toFontUnits(advance / advanceScale);
    const hasKerning = kerned.has(codePoint);
    let glyphId = hasKerning ? undefined : glyphIdByWidth.get(units);
    if (glyphId === undefined) {
      glyphId = glyphAdvances.push(units) - 1;
      if (!hasKerning) {
        glyphIdByWidth.set(units, glyphId);
      }
      advanceSum += units;
      advanceMax = Math.max(advanceMax, units);
    }
    charCodeToGlyphId.set(codePoint, glyphId);
    const char = Math.min(codePoint, 0xffff);
    firstChar = Math.min(firstChar, char);
    lastChar = Math.max(lastChar, char);
  }
  const numGlyphs = glyphAdvances.length;
  if (numGlyphs > 0xffff) {
    return null;
  }
  const ascender = Math.round(ascent * UNITS_PER_EM);
  const descender = ascender - UNITS_PER_EM;

  const builder = new OpenTypeFileBuilder("true");
  function createTable(tag, length) {
    const data = new Uint8Array(length);
    builder.addTable(tag, data);
    return new DataView(data.buffer);
  }

  const head = createTable("head", 54);
  head.setUint32(0, 0x00010000); // version
  head.setUint32(4, 0x00010000); // fontRevision
  head.setUint32(12, 0x5f0f3cf5); // magicNumber
  head.setUint16(16, 0x0003); // flags
  head.setUint16(18, UNITS_PER_EM);
  head.setInt16(38, descender); // yMin
  head.setInt16(42, ascender); // yMax
  head.setUint16(46, 8); // lowestRecPPEM
  head.setInt16(48, 2); // fontDirectionHint

  const maxWidth = vertical ? UNITS_PER_EM : advanceMax;
  function addMetrics(isVertical) {
    const header = createTable(isVertical ? "vhea" : "hhea", 36);
    header.setUint32(0, isVertical ? 0x00011000 : 0x00010000);
    header.setInt16(4, ascender);
    header.setInt16(6, descender);
    header.setUint16(10, isVertical ? advanceMax : maxWidth);
    if (drawBoxes) {
      header.setInt16(16, Math.min(isVertical ? advanceMax : maxWidth, 0x7fff));
    }
    header.setInt16(isVertical ? 20 : 18, 1); // caretSlopeRun or caretSlopeRise
    header.setUint16(34, numGlyphs);
    const metrics = createTable(isVertical ? "vmtx" : "hmtx", 4 * numGlyphs);
    for (let i = 0; i < numGlyphs; i++) {
      // Upright glyphs have a one-em column width and a PDF advance height.
      metrics.setUint16(
        4 * i,
        vertical && !isVertical ? UNITS_PER_EM : glyphAdvances[i]
      );
    }
  }
  addMetrics(false);
  if (vertical) {
    addMetrics(true);
  }

  const maxp = createTable("maxp", 32);
  maxp.setUint32(0, 0x00010000); // version
  maxp.setUint16(4, numGlyphs);
  maxp.setUint16(14, 2); // maxZones

  const os2 = createTable("OS/2", 96);
  os2.setUint16(0, 4); // version
  os2.setInt16(
    2,
    vertical ? UNITS_PER_EM : Math.round(advanceSum / (numGlyphs - 1))
  ); // xAvgCharWidth
  os2.setUint16(4, 400); // usWeightClass
  os2.setUint16(6, 5); // usWidthClass
  os2.setUint32(58, 0x5044464a, /* littleEndian = */ false); // achVendID ("PDFJ")
  os2.setUint16(62, 0xc0); // fsSelection: REGULAR, USE_TYPO_METRICS
  os2.setUint16(64, firstChar);
  os2.setUint16(66, lastChar);
  os2.setInt16(68, ascender); // sTypoAscender
  os2.setInt16(70, descender); // sTypoDescender
  os2.setUint16(74, ascender); // usWinAscent
  os2.setUint16(76, -descender); // usWinDescent
  os2.setUint16(92, 0x20); // usBreakChar
  os2.setUint16(94, 1); // usMaxContext

  if (drawBoxes) {
    const loca = createTable("loca", 4 * (numGlyphs + 1));
    const glyf = new DataBuilder({ exactLength: BOX_GLYPH_SIZE * numGlyphs });
    for (let i = 0; i < numGlyphs; i++) {
      const advance = glyphAdvances[i];
      writeBoxGlyph(
        glyf,
        vertical ? UNITS_PER_EM : advance,
        vertical ? ascender - Math.min(advance, 0x7fff) : descender,
        ascender
      );
      loca.setUint32(4 * (i + 1), glyf.length);
    }
    if (!glyf.length) {
      glyf.skip(1);
    }
    const xMax = Math.min(maxWidth, 0x7fff);
    if (vertical) {
      head.setInt16(38, ascender - Math.min(advanceMax, 0x7fff));
    }
    head.setInt16(40, xMax);
    head.setInt16(50, 1); // indexToLocFormat: long offsets
    maxp.setUint16(6, 8); // maxPoints
    maxp.setUint16(8, 2); // maxContours
    builder.addTable("glyf", glyf.data);
  } else {
    // Empty glyphs use zero loca offsets and a nonempty glyf table.
    builder.addTable("loca", new Uint8Array(2 * (numGlyphs + 1)));
    builder.addTable("glyf", new Uint8Array(1));
  }
  builder.addTable("cmap", createCmapTable(charCodeToGlyphId, null, numGlyphs));
  builder.addTable("name", (nameTable ??= createNameTable("PDFJSTextLayer")));
  builder.addTable("post", (postTable ??= createPostTable({ italicAngle: 0 })));

  if (pairs.length) {
    addKerningTable(builder, pairs, charCodeToGlyphId, advances, vertical);
  }
  return builder.toArray();
}

/**
 * Collects PDF glyph advances and builds the fonts for the text layer.
 */
class TextLayerFonts {
  #drawBoxes;

  #idFactory;

  #stats = new Map();

  /**
   * @param {object} idFactory
   * @param {boolean} [drawBoxes] - Debug: draw glyph bounds.
   */
  constructor(idFactory, drawBoxes = false) {
    this.#idFactory = idFactory;
    this.#drawBoxes = drawBoxes;
  }

  /**
   * @param {Font} font
   * @returns {object} The advance, ligature and space gap samples.
   */
  #getStats(font) {
    return this.#stats.getOrInsertComputed(font, createStats);
  }

  /**
   * @param {Font} font
   * @param {string} unicode - The text of the glyph.
   * @param {number} advance - In 1/1000 em.
   */
  addGlyph(font, unicode, advance) {
    if (!unicode) {
      return;
    }
    const { advances, ligatures } = this.#getStats(font);
    // Most PDF glyphs map to one UTF-16 code unit.
    if (unicode.length === 1) {
      if (unicode.isWellFormed()) {
        addCount(
          advances,
          unicode.charCodeAt(0),
          isZeroWidth(unicode) ? 0 : advance
        );
      }
      return;
    }
    let text = "",
      length = 0;
    for (const char of unicode) {
      if (!char.isWellFormed()) {
        continue;
      }
      if (isZeroWidth(char)) {
        addCount(advances, char.codePointAt(0), 0);
      } else {
        text += char;
        length++;
      }
    }
    if (length === 1) {
      addCount(advances, text.codePointAt(0), advance);
    } else if (length > 1) {
      addCount(ligatures, text, advance);
    }
  }

  /**
   * @param {Font} font
   * @param {number} gap - The gap replaced by a space, in 1/1000 em.
   */
  addSpaceGap(font, gap) {
    if (Number.isFinite(gap)) {
      this.#getStats(font).spaceGaps.push(gap);
    }
  }

  addKerning(font, left, right, advance) {
    addKerningSample(
      this.#getStats(font).kerning,
      getKerningKey(left, right),
      advance
    );
  }

  #getCache(font) {
    const docId = this.#idFactory.getDocId();
    let cache = fontCache.get(font);
    if (cache?.docId !== docId) {
      cache = { docId, normal: [], debug: [] };
      fontCache.set(font, cache);
    }
    return this.#drawBoxes ? cache.debug : cache.normal;
  }

  /**
   * @param {Font} font
   * @returns {object|null} The advances and kerning for fitting the spans.
   */
  getMetrics(font) {
    const stats = this.#stats.get(font);
    if (!stats) {
      return null;
    }
    const advances = getAdvances(stats);
    const kerning = getKerning(stats, advances, font);
    let max = 0;
    for (const advance of advances.values()) {
      max = Math.max(max, advance);
    }
    // A Type 3 font can have advances of many em. Keep the fitter in PDF
    // units, quantized to exactly the advances the generated font will use.
    let advanceScale = 1;
    if (max > MAX_ADVANCE && Number.isFinite(max)) {
      advanceScale = 2 ** Math.round(Math.log2(max / 1000));
      for (const map of [advances, kerning]) {
        for (const [key, value] of map) {
          map.set(key, roundFontAdvance(value / advanceScale) * advanceScale);
        }
      }
    }
    return {
      advances,
      kerning,
      advanceScale,
      spaceAdvance: roundFontAdvance(advances.get(0x20)),
    };
  }

  #findCachedFont(cache, advances, kerning, ascent, advanceScale) {
    let best,
      bestCoverage = 0;
    const useGpos = kerning.size > 0 && supportsKerningPositioning(advances);
    // Extra glyphs can change how the browser composes a sequence or picks
    // a glyph for a mirrored character.
    const needsMatchingCoverage = advances.keys().some(codePoint => {
      const char = String.fromCodePoint(codePoint);
      return SHAPING_REGEXP.test(char) || RTL_REGEXP.test(char);
    });
    for (const cached of cache) {
      const { advances: cachedAdvances, kerning: cachedKerning } = cached;
      if (
        cached.style.ascent !== ascent ||
        (cached.style.advanceScale ?? 1) !== advanceScale ||
        (useGpos &&
          !cached.style.vertical &&
          !supportsKerningPositioning(cachedAdvances))
      ) {
        continue;
      }
      const missing = countMissingAdvances(
        advances,
        cachedAdvances,
        advanceScale
      );
      if (
        missing < 0 ||
        cachedAdvances.size + missing > MAX_CACHED_CHARACTERS ||
        (needsMatchingCoverage &&
          (missing || advances.size !== cachedAdvances.size))
      ) {
        continue;
      }
      if (!missing && equalKerningOnPage(kerning, cachedKerning, advances)) {
        return { match: cached };
      }
      const coverage = advances.size - missing;
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        best = cached;
      }
    }
    if (!best) {
      return { advances, kerning };
    }

    // Extend the coverage of a compatible font. When both characters in a
    // pair are used on this page, keep the kerning decided for this page.
    const mergedAdvances = new Map(advances);
    for (const [codePoint, advance] of best.advances) {
      mergedAdvances.getOrInsert(codePoint, advance);
    }
    const mergedKerning = new Map(kerning);
    for (const [key, advance] of best.kerning) {
      if (mergedKerning.size >= MAX_KERNING_PAIRS) {
        break;
      }
      if (!pairCoveredBy(key, advances)) {
        mergedKerning.set(key, advance);
      }
    }
    return { advances: mergedAdvances, kerning: mergedKerning };
  }

  /**
   * @param {Font} font
   * @param {object|null} [metrics] - Metrics, with any fitted spaces added.
   * @returns {object|null} The generated text layer font.
   */
  build(font, metrics = this.getMetrics(font)) {
    if (!metrics) {
      return null;
    }
    // Vertical glyphs are centered on their column.
    const ascent = font.vertical ? 0.5 : getAscentRatio(font);
    const { advanceScale = 1 } = metrics;
    let { advances, kerning } = metrics;
    const cache =
      advances.size <= MAX_CACHED_CHARACTERS ? this.#getCache(font) : null;
    // Allow reuse only after the span fitter has chosen its spacing and
    // allocated any fixed-width spaces using this page's metrics.
    if (cache?.length) {
      const candidate = this.#findCachedFont(
        cache,
        advances,
        kerning,
        ascent,
        advanceScale
      );
      if (candidate.match) {
        return candidate.match;
      }
      ({ advances, kerning } = candidate);
    }
    const data = buildTextLayerFont(
      advances,
      ascent,
      this.#drawBoxes,
      kerning,
      font.vertical,
      advanceScale
    );
    if (!data) {
      return null;
    }
    const textLayerFont = {
      style: {
        name: `${this.#idFactory.getDocId()}_t${this.#idFactory.createFontId()}`,
        data,
        ascent,
      },
      advances,
      kerning,
    };
    if (advanceScale !== 1) {
      textLayerFont.style.advanceScale = advanceScale;
    }
    if (font.vertical) {
      textLayerFont.style.vertical = true;
    }
    if (cache) {
      cache.unshift(textLayerFont);
      if (cache.length > MAX_CACHED_FONTS) {
        cache.pop();
      }
    }
    return textLayerFont;
  }
}

export {
  buildTextLayerFont,
  getKerningKey,
  getShapedCodePoints,
  isZeroWidth,
  MAX_ADVANCE,
  roundFontAdvance,
  TextLayerFonts,
};
