/* Copyright 2022 Mozilla Foundation
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

import { FeatureTest } from "./util.js";

function applyMaskImageData({
  src,
  srcPos = 0,
  dest,
  destPos = 0,
  width,
  height,
  inverseDecode = false,
}) {
  const opaque = FeatureTest.isLittleEndian ? 0xff000000 : 0x000000ff;
  const [zeroMapping, oneMapping] = !inverseDecode ? [opaque, 0] : [0, opaque];
  const widthInSource = width >> 3;
  const widthRemainder = width & 7;
  const srcLength = src.length;
  dest = new Uint32Array(dest.buffer);

  for (let i = 0; i < height; i++) {
    for (const max = srcPos + widthInSource; srcPos < max; srcPos++) {
      const elem = srcPos < srcLength ? src[srcPos] : 255;
      dest[destPos++] = elem & 0b10000000 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b1000000 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b100000 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b10000 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b1000 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b100 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b10 ? oneMapping : zeroMapping;
      dest[destPos++] = elem & 0b1 ? oneMapping : zeroMapping;
    }
    if (widthRemainder === 0) {
      continue;
    }
    const elem = srcPos < srcLength ? src[srcPos++] : 255;
    for (let j = 0; j < widthRemainder; j++) {
      dest[destPos++] = elem & (1 << (7 - j)) ? oneMapping : zeroMapping;
    }
  }

  return { srcPos, destPos };
}

function decodeGrayscale1BPP({
  src,
  srcPos = 0,
  dest,
  destPos = 0,
  width,
  height,
}) {
  const black = FeatureTest.isLittleEndian ? 0xff000000 : 0x000000ff;
  const white = 0xffffffff;
  const transparent = 0;
  const widthInSource = width >> 3;
  const widthRemainder = width & 7;
  const srcLength = src.length;
  dest = new Uint32Array(dest.buffer);

  for (let i = 0; i < height; i++) {
    for (const max = srcPos + widthInSource; srcPos < max; srcPos++) {
      const elem = srcPos < srcLength ? src[srcPos] : transparent;
      dest[destPos++] = elem & 0b10000000 ? white : black;
      dest[destPos++] = elem & 0b1000000 ? white : black;
      dest[destPos++] = elem & 0b100000 ? white : black;
      dest[destPos++] = elem & 0b10000 ? white : black;
      dest[destPos++] = elem & 0b1000 ? white : black;
      dest[destPos++] = elem & 0b100 ? white : black;
      dest[destPos++] = elem & 0b10 ? white : black;
      dest[destPos++] = elem & 0b1 ? white : black;
    }
    if (widthRemainder === 0) {
      continue;
    }
    const elem = srcPos < srcLength ? src[srcPos++] : transparent;
    for (let j = 0; j < widthRemainder; j++) {
      dest[destPos++] = elem & (1 << (7 - j)) ? white : black;
    }
  }

  return { srcPos, destPos };
}

function decodeRGB24BPP({ src, srcPos = 0, dest, destPos = 0, width, height }) {
  dest = new Uint32Array(dest.buffer);
  if (FeatureTest.isLittleEndian) {
    // ABGR
    for (const max = srcPos + width * height * 4; srcPos < max; ) {
      dest[destPos++] =
        0xff000000 |
        src[srcPos++] /* R */ |
        (src[srcPos++] /* G */ << 8) |
        (src[srcPos++] /* B */ << 16);
    }
  } else {
    // RGBA
    for (const max = srcPos + width * height * 4; srcPos < max; ) {
      dest[destPos++] =
        (src[srcPos++] /* R */ << 24) |
        (src[srcPos++] /* G */ << 16) |
        (src[srcPos++] /* B */ << 8) |
        0xff;
    }
  }

  return { srcPos, destPos };
}

export { applyMaskImageData, decodeGrayscale1BPP, decodeRGB24BPP };
