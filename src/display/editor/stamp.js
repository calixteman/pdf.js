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

  #drawBitmap(width, height) {
    const canvas = this.#canvas;
    if (!canvas || (canvas.width === width && canvas.height === height)) {
      return;
    }
    const ctx = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    const bitmap = this.#scaleBitmap(width, height);
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
