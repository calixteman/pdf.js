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

import { AnnotationEditor } from "./editor.js";
import { AnnotationEditorType } from "../../shared/util.js";
import { StampAnnotationElement } from "../annotation_layer.js";

/**
 * Basic text editor in order to create a FreeTex annotation.
 */
class StampEditor extends AnnotationEditor {
  #bitmap = null;

  #bitmapId = null;

  #bitmapPromise = null;

  #bitmapUrl = null;

  #canvas = null;

  #observer = null;

  #resizeTimeoutId = null;

  static _type = "stamp";

  constructor(params) {
    super({ ...params, name: "stampEditor" });
    this.#bitmapUrl = params.bitmapUrl;
  }

  static initialize(_l10n) {}

  static updateDefaultParams(_type, _value) {}

  static get defaultPropertiesToUpdate() {
    return [];
  }

  get propertiesToUpdate() {
    return [];
  }

  #getBitmap() {
    if (this.#bitmapId) {
      this._uiManager.imageManager.getFromId(this.#bitmapId).then(data => {
        if (!data) {
          this.remove();
          return;
        }
        this.#bitmap = data.bitmap;
        this.#createCanvas();
      });
      return;
    }

    if (this.#bitmapUrl) {
      const url = this.#bitmapUrl;
      this.#bitmapUrl = null;
      this.#bitmapPromise = this._uiManager.imageManager
        .getFromUrl(url)
        .then(data => {
          this.#bitmapPromise = null;
          if (!data) {
            this.remove();
            return;
          }
          ({ bitmap: this.#bitmap, id: this.#bitmapId } = data);
          this.#createCanvas();
        });
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    this.#bitmapPromise = new Promise(resolve => {
      input.addEventListener("change", async () => {
        this.#bitmapPromise = null;
        if (input.files.length === 0) {
          this.remove();
        } else {
          const data = await this._uiManager.imageManager.getFromFile(
            input.files[0]
          );
          if (!data) {
            this.remove();
            return;
          }
          ({ bitmap: this.#bitmap, id: this.#bitmapId } = data);
          this.#bitmap = this.#denoiseBitmap(this.#bitmap);
          this.#createCanvas();
        }
        resolve();
      });
      input.addEventListener("cancel", () => {
        this.#bitmapPromise = null;
        this.remove();
        resolve();
      });
    });
    input.click();
  }

  /** @inheritdoc */
  remove() {
    if (this.#bitmapId) {
      this.#bitmap = null;
      this._uiManager.imageManager.deleteId(this.#bitmapId);
      this.#canvas?.remove();
      this.#canvas = null;
      this.#observer?.disconnect();
      this.#observer = null;
    }
    super.remove();
  }

  /** @inheritdoc */
  rebuild() {
    super.rebuild();
    if (this.div === null) {
      return;
    }

    if (this.#bitmapId) {
      this.#getBitmap();
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  onceAdded() {
    this.div.draggable = true;
    this.parent.addUndoableEditor(this);
    this.div.focus();
  }

  /** @inheritdoc */
  isEmpty() {
    return this.#bitmapPromise === null && this.#bitmap === null;
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();

    if (this.#bitmap) {
      this.#createCanvas();
    } else {
      this.div.classList.add("loading");
      this.#getBitmap();
    }

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAt(
        baseX * parentWidth,
        baseY * parentHeight,
        this.width * parentWidth,
        this.height * parentHeight
      );
    }

    return this.div;
  }

  #createCanvas() {
    const { div } = this;
    let { width, height } = this.#bitmap;
    const [pageWidth, pageHeight] = this.pageDimensions;
    if (this.width) {
      width = this.width * pageWidth;
      height = this.height * pageHeight;
    } else if (width > 0.75 * pageWidth || height > 0.75 * pageHeight) {
      // If the the image is too big compared to the page dimensions
      // (more than 75%) then we scale it down.
      const factor = Math.min(
        (0.75 * pageWidth) / width,
        (0.75 * pageHeight) / height
      );
      width *= factor;
      height *= factor;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(
      (width * parentWidth) / pageWidth,
      (height * parentHeight) / pageHeight
    );

    const canvas = (this.#canvas = document.createElement("canvas"));
    div.append(canvas);
    this.#drawBitmap(width, height);
    this.#createObserver();
    div.classList.remove("loading");
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  #setDimensions(width, height) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;
    this.setDims(width, height);
    if (this.#resizeTimeoutId !== null) {
      clearTimeout(this.#resizeTimeoutId);
    }
    this.#resizeTimeoutId = setTimeout(() => {
      this.#resizeTimeoutId = null;
      this.#drawBitmap(width, height);
    }, 200);
  }

  #scaleBitmap(width, height) {
    const { width: bitmapWidth, height: bitmapHeight } = this.#bitmap;

    let newWidth = bitmapWidth;
    let newHeight = bitmapHeight;
    let bitmap = this.#bitmap;
    while (newWidth > 2 * width || newHeight > 2 * height) {
      const prevWidth = newWidth;
      const prevHeight = newHeight;

      if (newWidth > 2 * width) {
        // See bug 1820511 (Windows specific bug).
        // TODO: once the above bug is fixed we could revert to:
        // newWidth = Math.ceil(newWidth / 2);
        newWidth =
          newWidth >= 16384
            ? Math.floor(newWidth / 2) - 1
            : Math.ceil(newWidth / 2);
      }
      if (newHeight > 2 * height) {
        newHeight =
          newHeight >= 16384
            ? Math.floor(newHeight / 2) - 1
            : Math.ceil(newHeight / 2);
      }

      const offscreenCanvas = new OffscreenCanvas(newWidth, newHeight);
      const offscreenCtx = offscreenCanvas.getContext("2d");
      offscreenCtx.drawImage(
        bitmap,
        0,
        0,
        prevWidth,
        prevHeight,
        0,
        0,
        newWidth,
        newHeight
      );
      bitmap = offscreenCanvas.transferToImageBitmap();
    }

    return bitmap;
  }

  #downScaleBitmap(bitmap, width, height) {
    const { width: bitmapWidth, height: bitmapHeight } = bitmap;

    let newWidth = bitmapWidth;
    let newHeight = bitmapHeight;
    while (newWidth > 2 * width || newHeight > 2 * height) {
      const prevWidth = newWidth;
      const prevHeight = newHeight;

      if (newWidth > 2 * width) {
        // See bug 1820511 (Windows specific bug).
        // TODO: once the above bug is fixed we could revert to:
        // newWidth = Math.ceil(newWidth / 2);
        newWidth =
          newWidth >= 16384
            ? Math.floor(newWidth / 2) - 1
            : Math.ceil(newWidth / 2);
      }
      if (newHeight > 2 * height) {
        newHeight =
          newHeight >= 16384
            ? Math.floor(newHeight / 2) - 1
            : Math.ceil(newHeight / 2);
      }

      const offscreenCanvas = new OffscreenCanvas(newWidth, newHeight);
      const offscreenCtx = offscreenCanvas.getContext("2d");
      //offscreenCtx.filter = "blur(1px)";
      offscreenCtx.drawImage(
        bitmap,
        0,
        0,
        prevWidth,
        prevHeight,
        0,
        0,
        newWidth,
        newHeight
      );
      bitmap = offscreenCanvas.transferToImageBitmap();
    }

    let offscreenCanvas = new OffscreenCanvas(width, height);
    let offscreenCtx = offscreenCanvas.getContext("2d");
    //offscreenCtx.filter = "grayscale(100%)";
    offscreenCtx.drawImage(
      bitmap,
      0,
      0,
      newWidth,
      newHeight,
      0,
      0,
      width,
      height
    );
    //offscreenCtx.fillStyle = "rgb(0,0,123)";
    //offscreenCtx.fillRect(0, 0, width, height);
    const g = x => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const f = x => 
      0.2126 * g(x & 0xff) + 0.7152 * g((x >> 8) & 0xff) + 0.0722 * g((x >> 16) & 0xff);
    
    const data = offscreenCtx.getImageData(0, 0, width, height).data;
    console.log("data", data)
    const buf32 = new Uint32Array(data.buffer);
    console.log("buf32", buf32)
    const newBuf32 = new Uint32Array(width * height);
    newBuf32.fill(0xffffffff);
    const pixels = new Float32Array(9);
    const maxDims = [];
    const thresh = 0.05;
    let toto = 10000;
    for (let j = 1; j < height; j++) {
      for (let i = 1; i < width; i++) {
        if (toto <= 100) {
          console.log("i", i, "j", j)
        }
        for (let k = 0; k < 9; k++) {
          pixels[k] = f(buf32[(j - 1 + k % 3) * width + (i - 1 + Math.floor(k / 3))]);
        }
        let maxDim = -Infinity;
        let sign = 0;
        const pix = pixels[4];
        for (let k = 0; k < 9; k++) {
          const dist = pixels[k] - pix; 
          const dim = Math.abs(dist);
          if (dim > maxDim) {
            maxDim = dim;
            sign = Math.sign(dist);
          }
        }

        if (false && maxDim >= thresh) {
          // Le pixel est different de ses voisins.
          let count = 0;
          for (let k = 0; k < 9; k++) {
            const dim = Math.abs(pix - pixels[k]);
            if (dim < thresh) {
              count += 1;
            }
          }
          if (count >= 3) {
            maxDim = 1;
          } else {
            maxDim = 0;
          }
        }

        //maxDims.push(maxDim);
        //console.log("pixels", )
        //const m = Math.max(pixels[4], (pixels[3] + pixels[5]) / 2);
        //m = m < 0.5 ? 0 : 1;
        let m = (maxDim >= thresh && sign === 1) ? 0 : 1;
        if (m === 1 && maxDim < thresh && i > 1 && j > 1 && i < width - 1 && j < height - 1) {
          for (let k = 0; k < 9; k++) {
            if (k === 4) {
              continue;
            }
            const x = newBuf32[(j - 1 + k % 3) * width + (i - 1 + Math.floor(k / 3))];
            if ((x & 0xff) === 0) {
              const y = f(buf32[(j - 1 + k % 3) * width + (i - 1 + Math.floor(k / 3))]);
              const dist = y - pix;
              if (Math.abs(y - pix) < thresh / 8) {
                if (toto <= 100) {
                  console.log("index", (i - 1 + Math.floor(k / 3)), (j - 1 + k % 3), "x", x, "y", y, "pix", pix, "maxDim", maxDim, "dist", Math.abs(y - pix))
                }
                m = 0.5;
                break;
              }
            }
          }
        }
        if (m === 0) {
          if (toto <= 100) {
            console.log("COCUCOU m=0", i, j, maxDim, sign, pix, pixels)
          }
          newBuf32[j * width + i] = 0xff000000;
        } else if (m === 1) {
          newBuf32[j * width + i] = 0xffffffff;
        } else {
          if (toto <= 100) {
            console.log("COCUCOU m=bleu", i, j)
          }
          newBuf32[j * width + i] = toto % 3 === 0 ? 0xffff0000 : (toto % 3 === 1 ? 0xff00ff00 : 0xff0000ff);
          if (toto === 1) {
            newBuf32[j * width + i] = 0xffff00ff;
          }
        }
        const mm = Math.round(pix * 255);
        if (newBuf32[j * width + i] === 0xffffffff) {
          ///newBuf32[j * width + i] = 0xff000000 | (mm << 16) | (mm << 8) | mm;
        }
      }
    }
    console.log("maxDims", maxDims)
    offscreenCtx.putImageData(new ImageData(new Uint8ClampedArray(newBuf32.buffer), width, height), 0, 0);

    bitmap = offscreenCanvas.transferToImageBitmap();
    
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    //ctx.filter = "grayscale(100%) url(#g_stamp_filter)";
    ctx.drawImage(
      bitmap,
      0,
      0,
    );
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext("2d");
    offscreenCtx.drawImage(canvas, 0, 0);

    bitmap = offscreenCanvas.transferToImageBitmap();

    return bitmap;
  }

  #denoiseBitmap(bitmap) {
    const { width: originalWidth, height: originalHeight } = bitmap;
    const width = 1024;
    const height = Math.ceil(originalHeight * (width / originalWidth));
    bitmap = this.#downScaleBitmap(bitmap, width, height);
    console.log("denoiseBitmap", bitmap.width, bitmap.height)
    /*const offscreenCanvas = new OffscreenCanvas(originalWidth, originalHeight);
    const offscreenCtx = offscreenCanvas.getContext("2d");
    offscreenCtx.drawImage(
      bitmap,
      0,
      0,
      width,
      height,
      0,
      0,
      originalWidth,
      originalHeight
    );
    bitmap = offscreenCanvas.transferToImageBitmap();*/
    return bitmap;
  }

  #drawBitmap(width, height) {
    const canvas = this.#canvas;
    if (!canvas || (canvas.width === width && canvas.height === height)) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    const bitmap = this.#scaleBitmap(width, height);
    const ctx = canvas.getContext("2d");
    //ctx.filter = "grayscale(100%) url(#g_stamp_filter)";
    ctx.drawImage(
      bitmap,
      0,
      0,
      bitmap.width,
      bitmap.height,
      0,
      0,
      width,
      height
    );
  }

  #serializeBitmap(toUrl) {
    if (toUrl) {
      // We convert to a data url because it's sync and the url can live in the
      // clipboard.
      const canvas = document.createElement("canvas");
      canvas.width = this.#bitmap.width;
      canvas.height = this.#bitmap.height;
      const ctx = canvas.getContext("2d");
      const { width, height } = this.#bitmap;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(this.#bitmap, 0, 0);

      return canvas.toDataURL();
    }

    const canvas = new OffscreenCanvas(this.#bitmap.width, this.#bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.#bitmap, 0, 0);

    return canvas.transferToImageBitmap();
  }

  /**
   * Create the resize observer.
   */
  #createObserver() {
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.#setDimensions(rect.width, rect.height);
      }
    });
    this.#observer.observe(this.div);
  }

  /** @inheritdoc */
  static deserialize(data, parent, uiManager) {
    if (data instanceof StampAnnotationElement) {
      return null;
    }
    const editor = super.deserialize(data, parent, uiManager);
    const { rect, bitmapUrl, bitmapId } = data;
    if (bitmapId && uiManager.imageManager.isValidId(bitmapId)) {
      editor.#bitmapId = bitmapId;
    } else {
      editor.#bitmapUrl = bitmapUrl;
    }

    const [parentWidth, parentHeight] = editor.pageDimensions;
    editor.width = (rect[2] - rect[0]) / parentWidth;
    editor.height = (rect[3] - rect[1]) / parentHeight;

    return editor;
  }

  /** @inheritdoc */
  serialize(isForCopying = false, context = null) {
    if (this.isEmpty()) {
      return null;
    }

    const serialized = {
      annotationType: AnnotationEditorType.STAMP,
      bitmapId: this.#bitmapId,
      pageIndex: this.pageIndex,
      rect: this.getRect(0, 0),
      rotation: this.rotation,
    };

    if (isForCopying) {
      // We don't know what's the final destination (this pdf or another one)
      // of this annotation and the clipboard doesn't support ImageBitmaps,
      // hence we serialize the bitmap to a data url.
      serialized.bitmapUrl = this.#serializeBitmap(/* toUrl = */ true);
      return serialized;
    }

    if (context === null) {
      return serialized;
    }

    if (!context.stamps) {
      context.stamps = new Set();
    }
    if (!context.stamps.has(this.#bitmapId)) {
      // We don't want to have multiple copies of the same bitmap in the
      // annotationMap, hence we only add the bitmap the first time we meet it.
      context.stamps.add(this.#bitmapId);
      serialized.bitmap = this.#serializeBitmap(/* toUrl = */ false);
    }
    return serialized;
  }
}

export { StampEditor };
