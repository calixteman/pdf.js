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

/** @typedef {import("../src/display/api").PDFPageProxy} PDFPageProxy */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/display_utils").PageViewport} PageViewport */
/** @typedef {import("./interfaces").IPDFLinkService} IPDFLinkService */

import { AnnotationEditorLayer } from "pdfjs-lib";

/**
 * @typedef {Object} AnnotationEditorLayerBuilderOptions
 * @property {HTMLDivElement} pageDiv
 * @property {PDFPageProxy} pdfPage
 * @property {AnnotationStorage} [annotationStorage]
 */

class AnnotationEditorLayerBuilder {
  static _allBuilders = new Set();

  static _isEnabled = false;

  /**
   * @param {AnnotationEditorLayerBuilderOptions} options
   */
  constructor({ pageDiv, pdfPage, annotationStorage = null }) {
    this.pageDiv = pageDiv;
    this.pdfPage = pdfPage;
    this.annotationStorage = annotationStorage;
    this.annotationEditorLayer = null;
    this.div = null;
    this._cancelled = false;
  }

  /**
   * @param {PageViewport} viewport
   * @param {string} intent (default value is 'display')
   * @returns {Promise<Object | void>} A promise that is resolved when rendering
   *   of the AnnotationEditor layer is complete. The first rendering will
   *   return an object with a `textDivs` property that  can be used with the
   *   TextHighlighter.
   */
  async render(viewport, intent = "display") {
    if (intent !== "display") {
      return;
    }

    if (this._cancelled) {
      return;
    }

    if (this.div) {
      this.annotationEditorLayer.update({ viewport: viewport.clone() });
      this.show();
      return;
    }

    // Create an AnnotationEditor layer div
    this.div = document.createElement("div");
    this.div.className = "annotationEditorLayer";
    this.div.tabIndex = 0;

    this.annotationEditorLayer = new AnnotationEditorLayer({
      div: this.div,
      annotationStorage: this.annotationStorage,
      pageIndex: this.pdfPage._pageIndex,
      enabled: AnnotationEditorLayerBuilder._isEnabled,
    });

    const parameters = {
      viewport: viewport.clone(),
      div: this.div,
      annotations: null,
      linkService: this.linkService,
      intent,
    };

    try {
      this.annotationEditorLayer.render(parameters);
    } catch (e) {
      console.error("ERROR", e);
    }

    AnnotationEditorLayerBuilder._allBuilders.add(this);
    this.pageDiv.appendChild(this.div);
  }

  static setEditorType(type) {
    if (AnnotationEditorLayer.toggleEditorType(type)) {
      this.enableAll();
    } else {
      this.disableAll();
    }
  }

  static enableAll() {
    if (!this._isEnabled) {
      for (const builder of this._allBuilders) {
        builder.annotationEditorLayer.enable();
      }
      this._isEnabled = true;
    }
  }

  static disableAll() {
    if (this._isEnabled) {
      for (const builder of this._allBuilders) {
        builder.annotationEditorLayer.disable();
      }
      this._isEnabled = false;
    }
  }

  cancel() {
    this._cancelled = true;
  }

  hide() {
    if (!this.div) {
      return;
    }
    this.div.hidden = true;
  }

  show() {
    if (!this.div) {
      return;
    }
    this.div.hidden = false;
  }

  destroy() {
    if (!this.div) {
      return;
    }
    this.pageDiv = null;
    this.div.remove();
    this.annotationEditorLayer.destroy();
    AnnotationEditorLayerBuilder._allBuilders.delete(this);
  }
}

export { AnnotationEditorLayerBuilder };
