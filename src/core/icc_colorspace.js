/* Copyright 2024 Mozilla Foundation
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
  DataType,
  initSync,
  Intent,
  qcms_convert_one,
  qcms_convert_one_array,
  qcms_convert_three,
  qcms_convert_three_array,
  qcms_convert_four,
  qcms_convert_four_array,
  qcms_transformer_one_from_memory,
  qcms_transformer_three_from_memory,
  qcms_transformer_four_from_memory,
  qcms_drop_transformer_one,
  qcms_drop_transformer_three,
  qcms_drop_transformer_four,
} from "../../external/qcms/qcms_pdf_js.js";
import { ColorSpace } from "./colorspace.js";
import { DEST_BUFFER } from "../../external/qcms/myjs.js";

class IccColorSpace extends ColorSpace {
  #transformer;

  #convertArray;

  #convertPixel;

  static #module = null;

  constructor(iccProfile, numComps) {
    super("ICCBased", numComps);
    IccColorSpace.#module ||= IccColorSpace.#load();
    DEST_BUFFER.wasm = IccColorSpace.#module;
    switch (numComps) {
      case 1:
        this.#transformer = qcms_transformer_one_from_memory(
          iccProfile,
          DataType.Gray8,
          Intent.Perceptual
        );
        this.#convertArray = src => qcms_convert_one_array(this.#transformer, src);
        this.#convertPixel = (src, srcOffset, dest, destOffset) => {
          const rgb = qcms_convert_one(
            this.#transformer,
            src[srcOffset] * 255,
          );
          const R = (rgb >> 16) & 0xff;
          const G = (rgb >> 8) & 0xff;
          const B = rgb & 0xff;
          dest[destOffset] = R;
          dest[destOffset + 1] = G;
          dest[destOffset + 2] = B;
        }
        break;
      case 3:
        this.#transformer = qcms_transformer_three_from_memory(
          iccProfile,
          DataType.RGB8,
          Intent.Perceptual
        );
        this.#convertArray = src => qcms_convert_three_array(this.#transformer, src);
        this.#convertPixel = (src, srcOffset, dest, destOffset) => {
          const rgb = qcms_convert_three(
            this.#transformer,
            src[srcOffset] * 255,
            src[srcOffset + 1] * 255,
            src[srcOffset + 2] * 255
          );
          const R = (rgb >> 16) & 0xff;
          const G = (rgb >> 8) & 0xff;
          const B = rgb & 0xff;
          dest[destOffset] = R;
          dest[destOffset + 1] = G;
          dest[destOffset + 2] = B;
        }
        break;
      case 4:
        this.#transformer = qcms_transformer_four_from_memory(
          iccProfile,
          DataType.CMYK,
          Intent.Perceptual
        );
        this.#convertArray = src => qcms_convert_four_array(this.#transformer, src);
        this.#convertPixel = (src, srcOffset, dest, destOffset) => {
          const rgb = qcms_convert_four(
            this.#transformer,
            src[srcOffset] * 255,
            src[srcOffset + 1] * 255,
            src[srcOffset + 2] * 255,
            src[srcOffset + 3] * 255,
          );
          const R = (rgb >> 16) & 0xff;
          const G = (rgb >> 8) & 0xff;
          const B = rgb & 0xff;
          dest[destOffset] = R;
          dest[destOffset + 1] = G;
          dest[destOffset + 2] = B;
        }
        break;
      default:
        throw new Error(`Unsupported number of components: ${numComps}`);
    }
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    try {
      this.#convertPixel(src, srcOffset, dest, destOffset);
    } catch (e) {
      console.error("FUOFUFOUFOUF", e);
      throw e;
    }
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (alpha01 === 0) {
     this.#convertArray(
        src.subarray(srcOffset, srcOffset + count * this.numComps),
        dest.subarray(destOffset, destOffset + count * 3)
      );
    } else {
      console.log("getRgbBuffer", count);
      let t = performance.now();
      DEST_BUFFER.buffer = dest.subarray(destOffset, destOffset + count * 4);
      const result = this.#convertArray(
        src.subarray(srcOffset, srcOffset + count * this.numComps)
      );
      console.log("convertArray", performance.now() - t);
      /*t = performance.now();
      for (let i = 0, j = 0, ii = result.length; i < ii; i += 3, j += 4) {
        dest[j + 0] = result[i + 0];
        dest[j + 1] = result[i + 1];
        dest[j + 2] = result[i + 2];
      }
      console.log("copy", performance.now() - t);*/
    }
  }

  // getOutputLength(inputLength, alpha01) {}

  destroy() {
    switch (this.numComps) {
      case 1:
        qcms_drop_transformer_one(this.#transformer);
        break;
      case 3:
        qcms_drop_transformer_three(this.#transformer);
        break;
      case 4:
        qcms_drop_transformer_four(this.#transformer);
        break;
    }
  }

  static #load() {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "../../external/qcms/qcms_pdf_js_bg.wasm", false);
    xhr.responseType = "arraybuffer";
    xhr.send(null);
    // await WebAssembly.instantiate(this.#buffer, imports);
    return initSync({ module: new Uint8Array(xhr.response) });
  }

  static cleanup() {
    this.#module = null;
  }
}

export { IccColorSpace };
