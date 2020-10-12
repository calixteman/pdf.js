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

import { NotSupportedError } from "./error.js";
import { EventDispatcher } from "./event.js";
import { PDFObject } from "./pdf_object.js";

class App extends PDFObject {
  constructor(data) {
    super(data);
    this.calculate = data.calculate;

    this._formsVersion = data.formsVersion || 0.0;
    this._language = data.language || "ENU";
    this._platform = data.platform || "WIN";
    this._document = data._document;
    this._specialId = true;
    this._setTimeout = setTimeout;
    this._clearTimeout = clearTimeout;
    this._setInterval = setInterval;
    this._clearInterval = clearInterval;

    this._calculationOrder = data.calculationOrder;
    this._objects = Object.create(null);
    this._eventDispatcher = new EventDispatcher(
      this._document,
      data.calculationOrder,
      this._objects
    );
  }

  get activeDocs() {
    return this._document.wrapped;
  }

  set activeDocs(_) {
    throw new NotSupportedError("app.activeDocs");
  }

  get focusRect() {
    /* TODO or not */
    return undefined;
  }

  set focusRect(_) {
    /* TODO or not */
  }

  get formsVersion() {
    return this._formsVersion;
  }

  set formsVersion(_) {}

  get language() {
    return this._language;
  }

  set language(_) {}

  get platform() {
    return this._platform;
  }

  set platform(_) {}

  get runtimeHighlight() {
    /* TODO */
    return undefined;
  }

  set runtimeHighlight(_) {
    /* TODO */
  }

  get runtimeHighlightColor() {
    /* TODO */
    return undefined;
  }

  set runtimeHighlightColor(_) {
    /* TODO */
  }

  get thermometer() {
    /* TODO or not */
    return undefined;
  }

  set thermometer(_) {}

  get toolbar() {
    /* TODO or not */
    return undefined;
  }

  set toolbar(_) {
    /* TODO or not */
  }

  get toolbarHorizontal() {
    return this.toolbar;
  }

  set toolbarHorizontal(value) {
    /* has been deprecated and it's now equivalent to toolbar */
    this.toolbar = value;
  }

  get toolbarVertical() {
    return this.toolbar;
  }

  set toolbarVertical(value) {
    /* has been deprecated and it's now equivalent to toolbar */
    this.toolbar = value;
  }

  get viewerType() {
    return "PDF.js";
  }

  set viewerType(_) {}

  get viewerVariation() {
    return "Full";
  }

  set viewerVariation(_) {}

  get viewerVersion() {
    return "10.0";
  }

  set viewerVersion(_) {}

  _dispatchEvent(pdfEvent) {
    this._eventDispatcher.dispatch(pdfEvent);
  }

  addMenuItem() {
    /* unimplemented */
  }

  addSubMenu() {
    /* unimplemented */
  }

  addToolButton() {
    /* unimplemented */
  }

  alert(
    cMsg,
    nIcon = 0,
    nType = 0,
    cTitle = "PDF.js",
    oDoc = null,
    oCheckbox = null
  ) {
    this._send({ id: "alert", value: cMsg });
  }

  beep() {
    /* unimplemented */
  }

  beginPriv() {
    /* unimplemented */
  }

  browseForDoc() {
    /* unimplemented */
  }

  clearInterval(oInterval) {
    return this._clearInterval(oInterval);
  }

  clearTimeOut(oTime) {
    return this._clearTimeout(oTime);
  }

  execDialog() {
    /* unimplemented */
  }

  findComponent() {
    /* unimplemented */
  }

  getNthPlugInName() {
    /* unimplemented */
  }

  getPath() {
    /* unimplemented */
  }

  goBack() {
    /* TODO */
  }

  goForward() {
    /* TODO */
  }

  hideMenuItem() {
    /* unimplemented */
  }

  hideToolbarButton() {
    /* unimplemented */
  }

  launchURL() {
    /* unimplemented because unsafe */
  }

  listMenuItems() {
    /* unimplemented */
  }

  listToolbarButtons() {
    /* unimplemented */
  }

  mailGetAddrs() {
    /* unimplemented */
  }

  mailMsg() {
    /* TODO or not ? */
  }

  response() {
    /* TODO */
  }

  removeToolButton() {
    /* unimplemented */
  }

  setInterval(cExpr, nMilliseconds = 1000) {
    return this._setInterval({ cExpr, nMilliseconds });
  }

  setTimeOut(cExpr, nMilliseconds = 1000) {
    return this._setTimeout({ cExpr, nMilliseconds });
  }

  trustedFunction() {
    /* unimplemented */
  }

  trustPropagatorFunction() {
    /* unimplemented */
  }

  /* Unsupported */
  get constants() {
    throw new NotSupportedError("app.constants");
  }

  set constants(_) {
    throw new NotSupportedError("app.constants");
  }

  get fromPDFConverters() {
    throw new NotSupportedError("app.fromPDFConverters");
  }

  set fromPDFConverters(_) {
    throw new NotSupportedError("app.fromPDFConverters");
  }

  get fullscreen() {
    throw new NotSupportedError("app.fullscreen");
  }

  set fullscreen(_) {
    throw new NotSupportedError("app.fullscreen");
  }

  get fs() {
    throw new NotSupportedError("app.fs");
  }

  set fs(_) {
    throw new NotSupportedError("app.fs");
  }

  get media() {
    throw new NotSupportedError("app.media");
  }

  set media(_) {
    throw new NotSupportedError("app.media");
  }

  get monitors() {
    throw new NotSupportedError("app.monitors");
  }

  set monitors(_) {
    throw new NotSupportedError("app.monitors");
  }

  get numPlugins() {
    throw new NotSupportedError("app.numPlugins");
  }

  set numPlugins(_) {
    throw new NotSupportedError("app.numPlugins");
  }

  get printColorProfiles() {
    throw new NotSupportedError("app.printColorProfiles");
  }

  set printColorProfiles(_) {
    throw new NotSupportedError("app.printColorProfiles");
  }

  get printerNames() {
    throw new NotSupportedError("app.printerNames");
  }

  set printerNames(_) {
    throw new NotSupportedError("app.printerNames");
  }

  get execMenuItem() {
    throw new NotSupportedError("app.execMenuItem");
  }

  set execMenuItem(_) {
    throw new NotSupportedError("app.execMenuItem");
  }

  get newDoc() {
    throw new NotSupportedError("app.newDoc");
  }

  set newDoc(_) {
    throw new NotSupportedError("app.newDoc");
  }

  get newFDF() {
    throw new NotSupportedError("app.newFDF");
  }

  set newFDF(_) {
    throw new NotSupportedError("app.newFDF");
  }

  get openDoc() {
    throw new NotSupportedError("app.openDoc");
  }

  set openDoc(_) {
    throw new NotSupportedError("app.openDoc");
  }

  get openFDF() {
    throw new NotSupportedError("app.openFDF");
  }

  set openFDF(_) {
    throw new NotSupportedError("app.openFDF");
  }

  get popUpMenuEx() {
    throw new NotSupportedError("app.popUpMenuEx");
  }

  set popUpMenuEx(_) {
    throw new NotSupportedError("app.popUpMenuEx");
  }

  get popUpMenu() {
    throw new NotSupportedError("app.popUpMenu");
  }

  set popUpMenu(_) {
    throw new NotSupportedError("app.popUpMenu");
  }
}

export { App };
