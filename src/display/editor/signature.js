/* Copyright 2025 Mozilla Foundation
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

import { AnnotationEditorType, shadow } from "../../shared/util.js";
import { DrawingEditor, DrawingOptions } from "./draw.js";
import { AnnotationEditor } from "./editor.js";
import { ContourDrawOutline } from "./drawers/contour.js";
import { InkDrawingOptions } from "./ink.js";
import { SignatureExtractor } from "./drawers/signaturedraw.js";

class SignatureOptions extends DrawingOptions {
  constructor() {
    super();

    super.updateProperties({
      fill: "black",
      "stroke-width": 0,
    });
  }

  clone() {
    const clone = new SignatureOptions();
    clone.updateAll(this);
    return clone;
  }
}

class DrawnSignatureOptions extends InkDrawingOptions {
  constructor(viewerParameters) {
    super(viewerParameters);

    super.updateProperties({
      stroke: "black",
      "stroke-width": 1,
    });
  }

  clone() {
    const clone = new DrawnSignatureOptions(this._viewParameters);
    clone.updateAll(this);
    return clone;
  }
}

/**
 * Basic draw editor in order to generate an Ink annotation.
 */
class SignatureEditor extends DrawingEditor {
  #isExtracted = false;

  static _type = "signature";

  static _editorType = AnnotationEditorType.SIGNATURE;

  static _defaultDrawingOptions = null;

  constructor(params) {
    super({ ...params, mustBeCommitted: true, name: "signatureEditor" });
    this._willKeepAspectRatio = false;
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    this._defaultDrawingOptions = new SignatureOptions();
    this._defaultDrawnSignatureOptions = new DrawnSignatureOptions(
      uiManager.viewParameters
    );
  }

  /** @inheritdoc */
  static getDefaultDrawingOptions(options) {
    const clone = this._defaultDrawingOptions.clone();
    clone.updateProperties(options);
    return clone;
  }

  /** @inheritdoc */
  static get supportMultipleDrawings() {
    return false;
  }

  static get typesMap() {
    return shadow(this, "typesMap", new Map());
  }

  static get isDrawer() {
    return false;
  }

  /** @inheritdoc */
  get isResizable() {
    return true;
  }

  /** @inheritdoc */
  isEmpty() {
    return this._drawId === null;
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    super.render();
    this.div.hidden = true;
    this.div.setAttribute("role", "figure");

    this._uiManager.getSignature(this);

    return this.div;
  }

  addSignature(outline, heightInPixels) {
    this.#isExtracted = outline instanceof ContourDrawOutline;
    let drawingOptions;
    if (this.#isExtracted) {
      drawingOptions = SignatureEditor.getDefaultDrawingOptions();
    } else {
      drawingOptions = SignatureEditor._defaultDrawnSignatureOptions.clone();
      drawingOptions.updateProperties({ "stroke-width": outline.thickness });
    }
    this._addOutlines({
      drawOutlines: outline,
      drawingOptions,
    });
    const [parentWidth, parentHeight] = this.parentDimensions;
    const [, pageHeight] = this.pageDimensions;
    let newHeight = heightInPixels / pageHeight;
    newHeight = newHeight >= 1 ? 0.5 : newHeight;
    this.width *= newHeight / this.height;
    this.height = newHeight;
    this.setDims(parentWidth * this.width, parentHeight * this.height);
    this.fixAndSetPosition();
    this._onResized();
    this.onScaleChanging();
    this.rotate();

    this.div.hidden = false;
  }

  extractSignature(bitmap) {
    const {
      rawDims: { pageWidth, pageHeight },
      rotation,
    } = this.parent.viewport;
    return SignatureExtractor.process(
      bitmap,
      pageWidth,
      pageHeight,
      rotation,
      SignatureEditor._INNER_MARGIN
    );
  }

  getDrawnSignature(curves) {
    const {
      rawDims: { pageWidth, pageHeight },
      rotation,
    } = this.parent.viewport;
    return SignatureExtractor.processDrawnLines(
      curves,
      pageWidth,
      pageHeight,
      rotation,
      SignatureEditor._INNER_MARGIN,
      false,
      false
    );
  }
}

export { SignatureEditor };
