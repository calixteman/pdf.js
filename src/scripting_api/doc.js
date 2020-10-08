/* Copyright 2020 Mozilla Foundation
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

import { PDFObject } from "./pdf_object.js";
import { PrintParams } from "./print_params.js";

class Doc extends PDFObject {
  constructor(data) {
    super(data);
    this.ADBE = undefined;
    this.author = data.author || "";
    this.baseURL = data.baseURL || "";
    this.bookmarkRoot = data.bookmarkRoot || null;
    this.calculate = data.calculate || false;
    this.creationDate = data.creationDate || null;
    this.creator = data.creator || "";
    this.delay = data.delay || false;
    this.dirty = data.dirty || false;
    this.documentFileName = data.documentFileName || "";
    this.external = data.external || true;
    this.filesize = data.filesize || 0;
    this.icons = data.icons || null;
    this.info = data.info || null;
    this.keywords = data.keywords || null;
    this.layout = data.layout || "";
    this.media = data.media || null;
    this.modDate = data.modDate || null;
    this.mouseX = data.mouseX || 0;
    this.mouseY = data.mouseY || 0;
    this.numFields = data.numFields || 0;
    this.numPages = data.numPages || 0;
    this.pageNum = data.pageNum || 0;
    this.pageWindowRect = data.pageWindowRect || [0, 0, 0, 0];
    this.path = data.path || "";
    this.producer = data.producer || "";
    this.subject = data.subject || "";
    this.title = data.title || "";
    this.URL = data.URL || "";
    this.zoom = data.zoom || 100;
    this.zoomType = data.zoomType || "NoVary";

    this._printParams = null;
  }

  addAnnot() {
    /* Not implemented */
  }

  addField() {
    /* Not implemented */
  }

  addLink() {
    /* Not implemented */
  }

  addIcon() {
    /* Not implemented */
  }

  calculateNow() {
    /* TODO */
  }

  closeDoc() {
    /* Not implemented */
  }

  createDataObject() {
    /* Not implemented */
  }

  deletePages() {
    /* Not implemented */
  }

  exportAsText() {
    /* Not implemented */
  }

  exportAsFDF() {
    /* Not implemented */
  }

  exportAsXFDF() {
    /* Not implemented */
  }

  extractPages() {
    /* Not implemented */
  }

  getAnnot() {
    /* TODO */
  }

  getAnnots() {
    /* TODO */
  }

  getAnnot3D() {
    /* Not implemented */
  }

  getAnnots3D() {
    /* Not implemented */
  }

  getField() {
    /* TODO */
  }

  getIcon() {
    /* TODO */
  }

  getLinks() {
    /* TODO */
  }

  getNthFieldName() {
    /* TODO */
  }

  getOCGs() {
    /* Not implemented */
  }

  getPageBox() {
    /* TODO */
  }

  getPageNthWord() {
    /* TODO */
  }

  getPageNthWordQuads() {
    /* TODO */
  }

  getPageNumWords() {
    /* TODO */
  }

  getPrintParams() {
    if (!this._printParams) {
      this._printParams = new PrintParams({ lastPage: this.pageNum });
    }
    return this._printParams;
  }

  getURL() {
    /* Not implemented because unsafe */
  }

  gotoNamedDest() {
    /* TODO */
  }

  importAnFDF() {
    /* Not implemented */
  }

  importAnXFDF() {
    /* Not implemented */
  }

  importTextData() {
    /* Not implemented */
  }

  insertPages() {
    /* Not implemented */
  }

  mailDoc() {
    /* TODO */
  }

  mailForm() {
    /* TODO */
  }

  print(
    bUI = true,
    nStart = 0,
    nEnd = -1,
    bSilent = false,
    bShrinkToFit = false,
    bPrintAsImage = false,
    bReverse = false,
    bAnnotations = true,
    printParams = null
  ) {
    // TODO: for now just use nStart and nEnd
    // so need to see how to deal with the other params
    // (if possible)
    if (printParams) {
      nStart = printParams.firstPage;
      nEnd = printParams.lastPage;
    }

    if (typeof nStart === "number") {
      nStart = Math.max(0, Math.trunc(nStart));
    } else {
      nStart = 0;
    }

    if (typeof nEnd === "number") {
      nEnd = Math.max(0, Math.trunc(nEnd));
    } else {
      nEnd = -1;
    }

    this._send({ id: "print", start: nStart, end: nEnd });
  }

  removeField() {
    /* TODO */
  }

  replacePages() {
    /* Not implemented */
  }

  resetForm() {
    /* TODO */
  }

  removeIcon() {
    /* Not implemented */
  }

  saveAs() {
    /* Not implemented */
  }

  submitForm() {
    /* TODO */
  }

  syncAnnotScan() {
    /* Not implemented */
  }
}

export { Doc };
