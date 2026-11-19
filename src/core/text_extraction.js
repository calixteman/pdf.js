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

import {
  bidi,
  getRunBidiType,
  isStrongBidiType,
  reorderBidiRuns,
} from "./bidi.js";
import {
  getKerningKey,
  getShapedCodePoints,
  isZeroWidth,
  MAX_ADVANCE,
  roundFontAdvance,
  TextLayerFonts,
} from "./text_layer_font.js";
import { AbortException } from "../shared/util.js";

// These scripts can be fitted using the generated font's advances and the
// visual glyph order. Fullwidth digits and Kana prolonged sound marks have
// script Common. Contextual and mixed-direction runs use width fitting.
const SIMPLE_TEXT =
  /^[ 0-9\u30fc\uff10-\uff19\uff70\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{Mn}\p{P}\p{Sc}\p{Sm}\p{Sk}]+$/u;
const SIMPLE_RTL_TEXT =
  /^[ \ufb50-\ufdff\ufe70-\ufefc\p{sc=Hebr}\p{Mn}\p{P}]+$/u;
// A descending sequence of RTL letters can be drawn in logical order.
// Digits in Arabic script still advance in LTR order.
const RTL_GLYPH = /^(?:[[\p{sc=Arab}\p{sc=Hebr}]&&\p{L}]\p{M}*)+$/v;
const GAP_STEP = 5; // thousandths of an em
const MIN_SPACE_GAP = 30;
// Firefox rounds spacing below this size to zero at 100% zoom.
const MIN_CSS_SPACING = 1 / 160;
const MAX_GLYPH_OVERLAP = 200;
const MAX_INLINE_SPACE = 600; // thousandths of an em
const FIXED_SPACE_STEP = 5; // thousandths of an em
// These are whitespace, and CSS word-spacing doesn't apply to them. Use
// U+2002 onwards since U+2000 and U+2001 have canonical decompositions.
const FIRST_FIXED_SPACE = 0x2002;
const LAST_FIXED_SPACE = 0x200a;
// In page units at 100% zoom. Leave room for CSS position and font rounding.
const POSITION_TOLERANCE = 0.75;

// Offsets and advances along the baseline are in thousandths of an em.
function transformAt([a, b, c, d, x, y], offset, vertical) {
  return [
    a,
    b,
    c,
    d,
    x + ((vertical ? -c : a) * offset) / 1000,
    y + ((vertical ? -d : b) * offset) / 1000,
  ];
}

function makeItem(str, dir, transform, length, fontName) {
  const vertical = dir === "ttb";
  return {
    str,
    dir,
    transform,
    width: vertical ? Math.hypot(transform[0], transform[1]) : length,
    height: vertical ? length : Math.hypot(transform[2], transform[3]),
    fontName,
    hasEOL: false,
  };
}

function makeSpaceItem(transform, advance, length, fontName, dir) {
  return makeItem(
    " ",
    dir,
    transformAt(transform, advance, dir === "ttb"),
    Math.max(0, length),
    fontName
  );
}

function getSpaceThreshold(spaceWidth) {
  return Math.max(102, Math.min(spaceWidth || 0, 333) / 2);
}

function hasSameAxes(left, right) {
  return (
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2] &&
    left[3] === right[3]
  );
}

// For a reflected transform with d > 0, move the origin to the other end
// of the baseline, then reverse its direction.
function getUnmirroredTransform([a, b, c, d, e, f], width) {
  if (a * d - b * c >= 0 || d <= 0) {
    return null;
  }
  const scale = width / Math.hypot(a, b);
  return [-a, -b, c, d, e + a * scale, f + b * scale];
}

// The evaluator walks each content stream in PDF drawing order. A run retains
// the cursor positions on one baseline and with one font and text transform.
class TextRuns {
  #emit;

  #run = null;

  #previous = {
    run: null,
    transform: null,
    glyph: null,
    textRise: null,
  };

  #space = false;

  constructor(emit) {
    this.#emit = emit;
  }

  addSpace() {
    this.#space = true;
  }

  addGlyph(
    fontName,
    transform,
    textRise,
    unicode,
    advance,
    charSpacing,
    spaceWidth,
    vertical
  ) {
    // Project onto the writing axis: +x for horizontal text, -y for vertical.
    const axis = vertical ? 2 : 0;
    const sign = vertical ? -1 : 1;
    const a = sign * transform[axis],
      b = sign * transform[axis + 1],
      x = transform[4],
      y = transform[5];

    const scale = Math.hypot(a, b) / 1000;
    if (!scale || !Number.isFinite(scale)) {
      return;
    }

    let leadingSpace;
    const previous = this.#previous;
    if (previous.run && previous.run.vertical !== vertical) {
      this.reset();
    }
    if (previous.run) {
      const {
        glyph: base,
        transform: prevTransform,
        textRise: prevTextRise,
      } = previous;
      const {
        scale: prevScale,
        spaceWidth: prevSpaceWidth,
        fontName: prevFontName,
      } = previous.run;
      const pa = sign * prevTransform[axis],
        pb = sign * prevTransform[axis + 1];
      const baselineLength = 1000 * prevScale;
      const dx = x - prevTransform[4],
        dy = y - prevTransform[5];
      const along = (dx * pa + dy * pb) / baselineLength;
      const across = (dy * pa - dx * pb) / baselineLength;
      const riseX = textRise[0] - prevTextRise[0];
      const riseY = textRise[1] - prevTextRise[1];
      const lineShift = across - (riseY * pa - riseX * pb) / baselineLength;
      const height = Math.hypot(
        prevTransform[2 - axis],
        prevTransform[3 - axis]
      );
      const sameAxes = hasSameAxes(transform, prevTransform);
      const sameFontAndAxes = prevFontName === fontName && sameAxes;
      if (
        this.#run &&
        sameFontAndAxes &&
        !this.#space &&
        Math.abs(lineShift) <= height &&
        isZeroWidth(unicode)
      ) {
        // Keep the mark with its base for bidi and kerning. Preserve the
        // PDF advance and text-state spacing when the mark moves the cursor.
        base.unicode += unicode;
        base.advance += advance;
        base.charSpacing += charSpacing;
        return;
      }
      // Some PDFs position each RTL glyph to the left of the previous one.
      // Measure that gap from the new glyph's right edge.
      const rtl =
        !vertical &&
        along < 0 &&
        sameAxes &&
        a * transform[3] - b * transform[2] > 0 &&
        RTL_GLYPH.test(base.unicode) &&
        RTL_GLYPH.test(unicode);
      const gap = rtl
        ? -along / prevScale - advance
        : along / prevScale - base.advance;
      // The cursor can move back from the end of a glyph, e.g. when a
      // spacing accent is overprinted on the next glyph. Allow rounding
      // errors at the cutoff so a 200-unit TJ can still be kerning.
      const backwards =
        (!rtl && along < -POSITION_TOLERANCE) ||
        gap + 1e-6 < Math.min(base.charSpacing, 0) - MAX_GLYPH_OVERLAP;
      const newLine =
        Math.abs(lineShift) >
        height * (backwards || along < -POSITION_TOLERANCE ? 0.5 : 1);
      if (newLine) {
        this.flush(true);
      } else if (
        !this.#run ||
        !sameFontAndAxes ||
        (this.#run.glyphs.length > 1 && this.#run.logicalRTL !== rtl) ||
        (rtl && gap > MAX_INLINE_SPACE) ||
        backwards ||
        Math.abs(
          (y - this.#run.transform[5]) * pa - (x - this.#run.transform[4]) * pb
        ) >
          baselineLength * 0.25
      ) {
        this.flush();
        if (
          !backwards &&
          ((this.#space && gap > MIN_SPACE_GAP) ||
            gap - base.charSpacing > getSpaceThreshold(prevSpaceWidth))
        ) {
          leadingSpace = makeSpaceItem(
            rtl ? transform : prevTransform,
            rtl ? advance : base.advance,
            gap * prevScale,
            rtl ? fontName : prevFontName,
            vertical ? "ttb" : "ltr"
          );
        }
      } else {
        this.#run.logicalRTL = rtl;
      }
    }

    this.#run ??= {
      fontName,
      transform,
      scale,
      spaceWidth,
      vertical,
      leadingSpace,
      glyphs: [],
      logicalRTL: false,
    };
    const { glyphs, transform: start } = this.#run;
    const offset =
      ((x - start[4]) * a + (y - start[5]) * b) / (1000 * scale * scale);
    const glyph = {
      unicode,
      offset,
      advance,
      charSpacing,
      space: glyphs.length > 0 && this.#space,
    };
    glyphs.push(glyph);
    previous.run = this.#run;
    previous.transform = transform;
    previous.glyph = glyph;
    previous.textRise = textRise;
    this.#space = false;
  }

  flush(hasEOL = false) {
    if (this.#run) {
      if (this.#run.logicalRTL) {
        // The fitter expects glyphs from left to right, with each space
        // attached to the glyph on its right. Keep marks with their base.
        const { glyphs } = this.#run;
        const start = glyphs.at(-1).offset;
        this.#run.transform = transformAt(this.#run.transform, start, false);
        for (let i = 0; i < glyphs.length; i++) {
          glyphs[i].offset -= start;
          glyphs[i].space = glyphs[i + 1]?.space ?? false;
        }
        glyphs.reverse();
      }
      this.#run.hasEOL = hasEOL;
      this.#emit(this.#run);
      this.#run = null;
    } else if (hasEOL && this.#previous.run) {
      const { transform, run } = this.#previous;
      this.#emit({
        str: "",
        dir: run.vertical ? "ttb" : "ltr",
        transform,
        fontName: run.fontName,
        width: 0,
        height: 0,
        hasEOL,
      });
    }
  }

  reset() {
    this.flush();
    this.#previous.run = null;
    this.#previous.glyph = null;
    this.#space = false;
  }
}

function getGap(left, right) {
  return right.offset - left.offset - left.advance;
}

function inferTracking(glyphs, threshold) {
  const bins = new Map();
  let samples = 0;
  for (let i = 1; i < glyphs.length; i++) {
    const left = glyphs[i - 1],
      right = glyphs[i];
    if (right.space) {
      continue;
    }
    const gap = getGap(left, right) - left.charSpacing;
    const value = Math.round(gap / GAP_STEP) * GAP_STEP;
    const bin = bins.get(value);
    if (bin) {
      bin.count++;
      bin.differentPairs ||=
        left.unicode !== bin.left || right.unicode !== bin.right;
    } else {
      bins.set(value, {
        left: left.unicode,
        right: right.unicode,
        count: 1,
        differentPairs: false,
      });
    }
    samples++;
  }

  // Prefer the gap closest to zero when two bins are equally frequent.
  let value = 0,
    count = 0;
  for (const [gap, { count: frequency }] of bins) {
    if (
      frequency > count ||
      (frequency === count && Math.abs(gap) < Math.abs(value))
    ) {
      value = gap;
      count = frequency;
    }
  }
  // A repeated pair alone is evidence of kerning. Repeated narrow gaps
  // between different pairs are tracking.
  if (!value || count < 3 || !bins.get(value).differentPairs) {
    return 0;
  }
  if (Math.abs(value) <= threshold) {
    return value;
  }
  // For wider gaps, look for a separate group of even wider word spaces.
  const maxTracking = bins.keys().some(gap => gap > value + threshold)
    ? 2.5 * threshold
    : 1.5 * threshold;
  return value > 0 && value < maxTracking && 2 * count >= samples ? value : 0;
}

function inferSpaces({ glyphs, spaceWidth }, fonts, font) {
  const threshold = getSpaceThreshold(spaceWidth);
  const tracking = inferTracking(glyphs, threshold);
  if (fonts) {
    for (const glyph of glyphs) {
      glyph.codePoints = getShapedCodePoints(glyph.unicode);
    }
  }
  for (let i = 1; i < glyphs.length; i++) {
    const left = glyphs[i - 1],
      right = glyphs[i];
    const gap = getGap(left, right);
    const adjustedGap = gap - left.charSpacing - tracking;
    right.space = right.space ? gap > MIN_SPACE_GAP : adjustedGap > threshold;
    if (!fonts) {
      continue;
    }
    if (right.space) {
      if (adjustedGap > 0) {
        fonts.addSpaceGap(font, adjustedGap);
      }
    } else if (left.codePoints.length && right.codePoints.length) {
      fonts.addKerning(
        font,
        left.codePoints.at(-1),
        right.codePoints[0],
        adjustedGap
      );
    }
  }
}

function makeTextItem(
  run,
  first,
  last,
  str,
  dir = run.vertical ? "ttb" : "ltr"
) {
  const { glyphs, scale, fontName } = run;
  const start = glyphs[first].offset;
  const { offset, advance } = glyphs[last];
  const end = offset + advance;
  return makeItem(
    str,
    dir,
    transformAt(run.transform, start, run.vertical),
    Math.abs(end - start) * scale,
    fontName
  );
}

function getText(glyphs, first, last, fixedSpaces) {
  const text = [glyphs[first].unicode];
  for (let i = first + 1; i <= last; i++) {
    const { space, unicode } = glyphs[i];
    if (space) {
      text.push(fixedSpaces?.get(i)?.char ?? " ");
    }
    text.push(unicode);
  }
  return text;
}

function getBaseAdvance(codePoints, font) {
  const { advances, kerning } = font;
  let width = 0,
    prev = -1;
  for (const codePoint of codePoints) {
    width += roundFontAdvance(advances.get(codePoint));
    if (prev >= 0) {
      width += kerning.get(getKerningKey(prev, codePoint)) || 0;
    }
    prev = codePoint;
  }
  return width;
}

// Contextual shaping and mixed bidi need browser measurement.
function hasSimpleGlyphOrder({ str, dir }, glyphs) {
  return dir === "rtl"
    ? SIMPLE_RTL_TEXT.test(str) && str === glyphs.toReversed().join("")
    : SIMPLE_TEXT.test(str) && str === glyphs.join("");
}

function widthFittedItem(item, font, visualText = item.str) {
  const { str } = item;
  if (!font || str.length < 2 || !/\S/.test(str)) {
    return item;
  }
  // Even with simple glyph order, mirroring, variation selectors or NFC
  // composition can change which glyphs the browser measures.
  if (
    (item.dir !== "rtl" || !/\p{Bidi_Mirrored}/u.test(visualText)) &&
    !/\p{Variation_Selector}/u.test(visualText) &&
    visualText === visualText.normalize("NFC")
  ) {
    for (const char of visualText) {
      if (isZeroWidth(char) && !font.advances.has(char.codePointAt(0))) {
        return item;
      }
    }
    const width = getBaseAdvance(getShapedCodePoints(visualText), font);
    if (Number.isFinite(width) && width > 0) {
      item.textLayerAdvance = width / 1000;
    }
  }
  return item;
}

// Check every glyph origin since many small gaps can add up.
function spacingFits(
  { glyphs, first, last, tolerance },
  { letterSpacing, wordSpacing, fixedSpaces }
) {
  let error = 0;
  for (let i = first + 1; i <= last; i++) {
    const { space, delta, letterCount } = glyphs[i];
    const fixedAdjustment = fixedSpaces?.get(i)?.adjustment;
    const gapError =
      letterCount * letterSpacing +
      (fixedAdjustment ?? (space ? wordSpacing : 0)) -
      delta;
    // Averaging an unusual word gap across the line shifts the next word,
    // even when later gaps bring the accumulated error back within tolerance.
    // Give it a fixed-width space when it differs by more than half the budget.
    if (space && Math.abs(gapError) > tolerance / 2) {
      return false;
    }
    error += gapError;
    if (Math.abs(error) > tolerance) {
      return false;
    }
  }
  return true;
}

function fitSpacing(span, minSpacing, font) {
  const { glyphs, first, last } = span;
  let letters = 0,
    spaces = 0,
    letterDelta = 0,
    wordDelta = 0,
    wordLetters = 0;
  for (let i = first + 1; i <= last; i++) {
    const { space, delta, letterCount } = glyphs[i];
    if (space) {
      spaces++;
      wordDelta += delta;
      wordLetters += letterCount;
    } else {
      letters += letterCount;
      letterDelta += delta;
    }
  }
  const letterSpacing = letters ? letterDelta / letters : 0;
  const wordSpacing = spaces
    ? (wordDelta - wordLetters * letterSpacing) / spaces
    : 0;
  const exact = { letterSpacing, wordSpacing };
  const rounded = {
    letterSpacing: Math.abs(letterSpacing) < minSpacing ? 0 : letterSpacing,
    wordSpacing: Math.abs(wordSpacing) < minSpacing ? 0 : wordSpacing,
  };
  if (spacingFits(span, rounded)) {
    return rounded;
  }
  if (
    (rounded.letterSpacing !== letterSpacing ||
      rounded.wordSpacing !== wordSpacing) &&
    spacingFits(span, exact)
  ) {
    return exact;
  }
  if (spaces <= 1) {
    return null;
  }
  if (rounded.letterSpacing !== letterSpacing) {
    const fit = fitUnevenSpaces(span, rounded.letterSpacing, minSpacing, font);
    if (fit) {
      return fit;
    }
  }
  return fitUnevenSpaces(span, letterSpacing, minSpacing, font);
}

// Reserve a representable space of the requested width. A trial fit keeps
// new advances in its own map until all the glyph positions have been checked.
function getFixedSpace(
  gap,
  { advances, advanceScale, spaceAdvance },
  tolerance,
  pending
) {
  const width = Math.round(gap / FIXED_SPACE_STEP) * FIXED_SPACE_STEP;
  const units = width / advanceScale;
  const encoded = roundFontAdvance(units) * advanceScale;
  if (
    !(units > 0 && units <= MAX_ADVANCE) ||
    Math.abs(encoded - gap) > tolerance
  ) {
    return null;
  }
  let codePoint;
  for (let cp = FIRST_FIXED_SPACE; cp <= LAST_FIXED_SPACE; cp++) {
    const advance = pending?.get(cp) ?? advances.get(cp);
    if (advance === width) {
      codePoint = cp;
      break;
    }
    if (advance === undefined) {
      codePoint ??= cp;
    }
  }
  if (codePoint === undefined) {
    return null;
  }
  if (!advances.has(codePoint)) {
    (pending ?? advances).set(codePoint, width);
  }
  return {
    char: String.fromCharCode(codePoint),
    adjustment: encoded - spaceAdvance,
  };
}

function fitUnevenSpaces(span, letterSpacing, minSpacing, font) {
  const { advances, spaceAdvance } = font;
  const { glyphs, first, last, tolerance } = span;
  const gaps = new Map();
  for (let i = first + 1; i <= last; i++) {
    const { space, delta, letterCount } = glyphs[i];
    if (space) {
      gaps.set(i, delta - letterCount * letterSpacing);
    }
  }
  const sorted = Array.from(gaps.values()).sort((a, b) => a - b);
  let wordSpacing = sorted[sorted.length >> 1];
  if (Math.abs(wordSpacing) < minSpacing) {
    wordSpacing = 0;
  }
  const fixedSpaces = new Map();
  const addedAdvances = new Map();
  for (const [i, gap] of gaps) {
    if (Math.abs(gap - wordSpacing) <= tolerance / 2) {
      continue;
    }
    const fixed = getFixedSpace(
      spaceAdvance + gap,
      font,
      tolerance / 2,
      addedAdvances
    );
    if (!fixed) {
      return null;
    }
    fixedSpaces.set(i, fixed);
  }
  const spacing = { letterSpacing, wordSpacing, fixedSpaces };
  if (!fixedSpaces.size || !spacingFits(span, spacing)) {
    return null;
  }
  for (const [codePoint, width] of addedAdvances) {
    advances.set(codePoint, width);
  }
  return spacing;
}

// Compute the spacing the browser needs on top of the generated font's
// advances to reach each glyph's position in the PDF.
function measureGlyphGaps(glyphs, font, tolerance) {
  let previousWidth;
  for (const [i, glyph] of glyphs.entries()) {
    const { codePoints, space } = glyph;
    const width = getBaseAdvance(codePoints, font);
    if (
      !codePoints.length ||
      !Number.isFinite(width) ||
      glyph.unicode.includes(" ")
    ) {
      return false;
    }
    // A PDF font may draw the same character with two different widths.
    // Letter spacing can fit the next origin but cannot size the glyph itself.
    if (
      codePoints.length === 1 &&
      width > 0 &&
      Math.abs(width - glyph.advance) > tolerance
    ) {
      glyph.textLayerAdvance = width / 1000;
    }
    if (i > 0) {
      const { offset: prevOffset, codePoints: prevCodePoints } = glyphs[i - 1];
      const extraAdvance = space
        ? font.spaceAdvance
        : font.kerning.get(
            getKerningKey(prevCodePoints.at(-1), codePoints[0])
          ) || 0;
      glyph.delta = glyph.offset - prevOffset - previousWidth - extraAdvance;
      glyph.letterCount = prevCodePoints.length + Number(space);
    }
    previousWidth = width;
  }
  return true;
}

function getBidiRun(run) {
  const { glyphs, vertical } = run;
  const last = glyphs.length - 1;
  const text = getText(glyphs, 0, last);
  const fullItem = makeTextItem(run, 0, last, "");
  const unmirrored =
    !vertical && getUnmirroredTransform(fullItem.transform, fullItem.width);
  if (unmirrored) {
    text.reverse();
    fullItem.transform = unmirrored;
  }
  Object.assign(fullItem, bidi(text, -1, vertical));
  return {
    run,
    item: fullItem,
    type: getRunBidiType(fullItem),
    text,
    unmirrored,
  };
}

function layoutRun({ run, item: fullItem, text, unmirrored }, font) {
  const { glyphs, scale, vertical } = run;
  const last = glyphs.length - 1;
  const thickness = vertical ? fullItem.width : fullItem.height;
  const tolerance = POSITION_TOLERANCE / scale;
  if (!hasSimpleGlyphOrder(fullItem, text)) {
    return [fullItem];
  }
  if (
    unmirrored ||
    (vertical && !thickness) ||
    !measureGlyphGaps(glyphs, font, tolerance)
  ) {
    return [widthFittedItem(fullItem, font, text.join(""))];
  }

  const { dir } = fullItem;
  const isRTL = dir === "rtl";
  const items = [];
  const minSpacing = (1000 * MIN_CSS_SPACING) / thickness;
  function spanText(first, end, fixedSpaces) {
    const parts = getText(glyphs, first, end, fixedSpaces);
    return (isRTL ? parts.reverse() : parts).join("");
  }

  function fit(first, end) {
    const glyph = glyphs[first];
    if (first === end && glyph.textLayerAdvance) {
      const item = makeTextItem(run, first, end, glyph.unicode, dir);
      item.textLayerAdvance = glyph.textLayerAdvance;
      return item;
    }
    const spacing = fitSpacing(
      { glyphs, first, last: end, tolerance },
      minSpacing,
      font
    );
    if (!spacing) {
      return null;
    }
    const { letterSpacing, wordSpacing, fixedSpaces } = spacing;
    const item = makeTextItem(run, first, end, spanText(first, end), dir);
    item.letterSpacing = letterSpacing / 1000;
    item.wordSpacing = wordSpacing / 1000;
    if (fixedSpaces) {
      item.textLayerStr = spanText(first, end, fixedSpaces);
    }
    return item;
  }

  function append(first, end) {
    const item = fit(first, end);
    if (!item) {
      const middle = (first + end) >> 1;
      append(first, middle);
      append(middle + 1, end);
      return;
    }
    // Emit the measured gap at the start of each fitted span, whichever
    // constraint caused the split.
    if (first > 0 && glyphs[first].space) {
      const left = glyphs[first - 1];
      items.push(
        makeSpaceItem(
          run.transform,
          left.offset + left.advance,
          getGap(left, glyphs[first]) * scale,
          run.fontName,
          dir
        )
      );
    }
    items.push(item);
  }
  let first = 0;
  for (let i = 1; i <= last; i++) {
    const left = glyphs[i - 1],
      right = glyphs[i];
    if (
      left.textLayerAdvance ||
      right.textLayerAdvance ||
      (right.space && getGap(left, right) > MAX_INLINE_SPACE)
    ) {
      append(first, i - 1);
      first = i;
    }
  }
  append(first, last);
  return isRTL ? items.reverse() : items;
}

// Both origins are at the left edge of a horizontal span, including when
// its baseline is rotated. Allow neighboring font sizes to shift it slightly.
function followsOnBaseline(left, right) {
  const [a, b, , , x, y] = left.transform;
  const [c, d, , , u, v] = right.transform;
  const scale = Math.hypot(a, b);
  const dx = u - x,
    dy = v - y;
  const along = (a * dx + b * dy) / scale;
  const gap = along - left.width;
  const dot = a * c + b * d;
  return (
    dot > 0 &&
    Math.abs(a * d - b * c) <= 1e-6 * dot &&
    Math.abs(a * dy - b * dx) <=
      (scale * Math.min(left.height, right.height)) / 2 &&
    along > 0 &&
    gap >= -POSITION_TOLERANCE &&
    // A larger gap can separate columns or unrelated form fields.
    gap <= 2 * Math.max(left.height, right.height)
  );
}

function startsAtRightEdge(space, span) {
  if (!hasSameAxes(space.transform, span.transform)) {
    return false;
  }
  const [a, b, , , x, y] = span.transform;
  const scale = Math.hypot(a, b);
  return (
    Math.hypot(
      space.transform[4] - x - (a / scale) * span.width,
      space.transform[5] - y - (b / scale) * span.width
    ) <= 1e-5
  );
}

// Extend the fitted span whose right edge coincides with the start of the gap.
// Its origin stays fixed, so the space is a prefix in RTL and a suffix in LTR.
function attachSpace(space, span, getMetrics) {
  if (
    span?.dir !== space.dir ||
    span.letterSpacing === undefined ||
    span.fontName !== space.fontName ||
    space.dir === "ttb" ||
    space.hasEOL ||
    (space.dir === "ltr" && span.hasEOL) ||
    !startsAtRightEdge(space, span)
  ) {
    return false;
  }
  const scale = Math.hypot(span.transform[0], span.transform[1]);
  const font = getMetrics(span.fontName);
  // CSS adds letter-spacing after both the last glyph and the new space.
  const gap = 1000 * (space.width / scale - 2 * span.letterSpacing);
  if (gap < 0) {
    return false;
  }
  const wordSpacing = (gap - font.spaceAdvance) / 1000;
  const rendered = span.textLayerStr ?? span.str;
  let renderedSpace = " ";
  if (!/\s/u.test(rendered)) {
    span.wordSpacing = wordSpacing;
  } else if (
    Math.abs(wordSpacing - span.wordSpacing) * scale >
    MIN_CSS_SPACING
  ) {
    const fixed = getFixedSpace(gap, font, (1000 * POSITION_TOLERANCE) / scale);
    if (!fixed) {
      return false;
    }
    renderedSpace = fixed.char;
  }
  const rtl = span.dir === "rtl";
  span.str = rtl ? " " + span.str : span.str + " ";
  if (span.textLayerStr || renderedSpace !== " ") {
    span.textLayerStr = rtl
      ? renderedSpace + rendered
      : rendered + renderedSpace;
  }
  span.width += space.width;
  return true;
}

function compactSpaces(items, getMetrics) {
  let length = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.str === " ") {
      const span = item.dir === "rtl" ? items[i + 1] : items[length - 1];
      if (attachSpace(item, span, getMetrics)) {
        continue;
      }
    }
    items[length++] = item;
  }
  items.length = length;
}

/**
 * Buffers the page's runs to infer word spaces and font kerning before fitting
 * individual spans to their glyph positions.
 */
class TextExtraction {
  #chunks = [];

  #fonts = new Map();

  // Baseline items in visual order, buffered across stream chunks.
  #line = [];

  #sink;

  constructor(sink, idFactory, debugFonts) {
    this.#sink = sink;
    this.fonts = idFactory ? new TextLayerFonts(idFactory, debugFonts) : null;
  }

  get ready() {
    if (!this.fonts) {
      return this.#sink.ready;
    }
    return this.#sink.isCancelled
      ? Promise.reject(new AbortException("Text content stream cancelled."))
      : Promise.resolve();
  }

  get desiredSize() {
    return this.fonts ? Infinity : this.#sink.desiredSize;
  }

  enqueue(chunk) {
    const { fonts } = this;
    for (const item of chunk.items) {
      if (item.glyphs) {
        inferSpaces(item, fonts, this.#fonts.get(item.fontName));
      }
    }
    if (fonts) {
      this.#chunks.push({ ...chunk });
    } else {
      const items = this.#layoutItems(chunk.items);
      this.#sink.enqueue({ ...chunk, items }, items.length);
    }
  }

  #flushLine(result, getMetrics) {
    reorderBidiRuns(this.#line);
    for (const entry of this.#line) {
      const font = entry.run && getMetrics?.(entry.item.fontName);
      if (font) {
        for (const part of layoutRun(entry, font)) {
          result.push(part);
        }
      } else {
        result.push(entry.item);
      }
    }
    this.#line.length = 0;
  }

  #layoutItems(items, getMetrics) {
    const result = [];
    for (const item of items) {
      if (!item.glyphs) {
        this.#flushLine(result, getMetrics);
        // The legacy extraction path can also emit vertical text items.
        result.push(
          getMetrics && item.dir === "ttb" && SIMPLE_TEXT.test(item.str)
            ? widthFittedItem(item, getMetrics(item.fontName))
            : item
        );
        continue;
      }
      const entry = getBidiRun(item);
      const current = entry.item;
      const previous = this.#line.at(-1);
      let space = item.leadingSpace && { item: item.leadingSpace, type: "WS" };
      if (previous) {
        const atPrevious =
          space && startsAtRightEdge(space.item, previous.item);
        // A measured gap can bridge a label and its text. Keep distant
        // columns of strong text in the order supplied by the PDF.
        const bothStrong =
          isStrongBidiType(previous.type) && isStrongBidiType(entry.type);
        const edge = atPrevious && !bothStrong ? space.item : previous.item;
        if (item.vertical || !followsOnBaseline(edge, current)) {
          if (atPrevious && previous.item.dir === current.dir) {
            this.#line.push(space);
            space = null;
          }
          this.#flushLine(result, getMetrics);
        }
      }

      // A gap belongs at its physical position on the baseline. If the PDF
      // jumped to another column and the gap touches neither run's edge,
      // leave it between the two groups in content-stream order.
      if (space && !item.vertical && startsAtRightEdge(space.item, current)) {
        this.#line.push(entry, space);
      } else {
        if (space && this.#line.length) {
          this.#line.push(space);
        } else if (space) {
          result.push(space.item);
        }
        this.#line.push(entry);
      }
      if (item.hasEOL || item.vertical) {
        this.#flushLine(result, getMetrics);
        result.at(-1).hasEOL = item.hasEOL;
      }
    }
    return result;
  }

  addFont(name, font) {
    this.#fonts.set(name, font);
  }

  send() {
    const { fonts } = this;
    if (this.#sink.isCancelled) {
      return;
    }
    if (!fonts) {
      if (this.#line.length) {
        const items = [];
        this.#flushLine(items);
        this.#sink.enqueue(
          { items, styles: Object.create(null), lang: null },
          items.length
        );
      }
      return;
    }
    // Fit all spans before serializing the fonts, since fitting can add
    // fixed-width space glyphs to their advances.
    const fontMetrics = new Map();
    const getMetrics = font => fonts.getMetrics(font);
    const getMetricsByName = name =>
      fontMetrics.getOrInsertComputed(this.#fonts.get(name), getMetrics);
    for (const chunk of this.#chunks) {
      chunk.items = this.#layoutItems(chunk.items, getMetricsByName);
    }
    if (this.#line.length) {
      this.#flushLine(this.#chunks.at(-1).items, getMetricsByName);
    }
    for (const chunk of this.#chunks) {
      compactSpaces(chunk.items, getMetricsByName);
    }
    const builtFonts = new Map();
    const build = font =>
      fonts.build(font, fontMetrics.getOrInsertComputed(font, getMetrics));
    for (const chunk of this.#chunks) {
      for (const [name, style] of Object.entries(chunk.styles)) {
        const font = builtFonts.getOrInsertComputed(
          this.#fonts.get(name),
          build
        );
        if (font) {
          style.textLayerFont = font.style;
        }
      }
      this.#sink.enqueue(chunk, chunk.items.length);
    }
  }
}

export { getUnmirroredTransform, TextExtraction, TextRuns };
