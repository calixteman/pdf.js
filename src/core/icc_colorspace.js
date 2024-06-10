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
  qcms_drop_profile,
  qcms_drop_transform,
  qcms_profile_from_memory,
  qcms_profile_srgb,
  qcms_transform_create,
  qcms_transform_data,
} from "../../external/qcms/qcms_pdf_js.js";
import { ColorSpace } from "./colorspace.js";

class IccColorSpace extends ColorSpace {
  #profile;

  #rgbProfile;

  #transform;

  static #module = null;

  constructor(iccProfile, numComps) {
    super("ICCBased", numComps);
    IccColorSpace.#module ||= IccColorSpace.#load();
    this.#profile = qcms_profile_from_memory(iccProfile);
    this.#rgbProfile = qcms_profile_srgb();
    let dataType;
    this.toto = true;
    switch (numComps) {
      case 1:
        dataType = DataType.Gray8;
        break;
      case 3:
        dataType = DataType.RGB8;
        break;
      case 4:
        dataType = DataType.CMYK;
        break;
      default:
        throw new Error(`Unsupported number of components: ${numComps}`);
    }
    this.#transform = qcms_transform_create(
      this.#profile,
      dataType,
      this.#rgbProfile,
      DataType.RGB8,
      Intent.Perceptual
    );
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    const srcArray = new Uint8Array(this.numComps);
    for (let i = 0; i < this.numComps; i++) {
      srcArray[i] = src[srcOffset + i] * 255;
    }
    if (ArrayBuffer.isView(dest)) {
      qcms_transform_data(
        this.#transform,
        srcArray,
        dest.subarray(destOffset, destOffset + 3)
      );
    } else {
      const output = new Uint8Array(3);
      qcms_transform_data(this.#transform, srcArray, output);
      dest.set(output, destOffset);
    }
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    console.log("getRgbBuffer");
    // console.log("COUCOU", count, this.numComps, bits, alpha01);
    if (alpha01 === 0) {
      qcms_transform_data(
        this.#transform,
        src.subarray(srcOffset, srcOffset + count * this.numComps),
        dest.subarray(destOffset, destOffset + count * 3)
      );
    } else {
      dest = dest.subarray(destOffset, destOffset + count * 4);
      const output = new Uint8Array(count * 3);
      qcms_transform_data(
        this.#transform,
        src.subarray(srcOffset, srcOffset + count * this.numComps),
        output
      );
      for (let i = 0, j = 0, ii = output.length; i < ii; i += 3, j += 4) {
        dest[j + 0] = output[i + 0];
        dest[j + 1] = output[i + 1];
        dest[j + 2] = output[i + 2];
      }
    }
  }

  // getOutputLength(inputLength, alpha01) {}

  destroy() {
    qcms_drop_transform(this.#transform);
    qcms_drop_profile(this.#profile);
    qcms_drop_profile(this.#rgbProfile);
  }

  static #load() {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "../../external/qcms/qcms_pdf_js_bg.wasm", false);
    xhr.responseType = "arraybuffer";
    xhr.send(null);
    return initSync(new Uint8Array(xhr.response));
  }

  static cleanup() {
    this.#module = null;
  }
}

export { IccColorSpace };
