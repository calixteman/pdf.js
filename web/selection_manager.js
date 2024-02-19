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

class SelectionManager {
  #anchorNode;

  #anchorOffset;

  #anchorTextLayer;

  #focusNode;

  #focusOffset;

  #ranges = [];

  #isDown = false;

  #toDrawLayer = new WeakMap();

  static #caretPositionFromPoint(x, y) {
    if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
      if (document.caretPositionFromPoint) {
        return document.caretPositionFromPoint(x, y);
      }
      const { startContainer: offsetNode, startOffset: offset } =
        document.caretRangeFromPoint(x, y);
      return { offsetNode, offset };
    }
    return document.caretPositionFromPoint(x, y);
  }

  add(textLayer, drawLayer) {
    this.#toDrawLayer.set(textLayer, drawLayer);
  }

  pointerDown({ x, y, target }) {
    if (target.getAttribute("role") !== "presentation") {
      return;
    }
    this.#anchorTextLayer = target.closest(".textLayer");
    this.#isDown = true;
    ({ offsetNode: this.#anchorNode, offset: this.#anchorOffset } =
      SelectionManager.#caretPositionFromPoint(x, y));
  }

  pointerMove({ x, y, target }) {
    if (!this.#isDown || target.getAttribute("role") !== "presentation") {
      return;
    }
    ({ offsetNode: this.#focusNode, offset: this.#focusOffset } =
      SelectionManager.#caretPositionFromPoint(x, y));
    this.#drawSelection();
  }

  pointerUp(evt) {
    this.pointerMove(evt);
    this.#isDown = false;
  }

  acceptNode(node) {
    if (
      node.nodeType === Node.TEXT_NODE ||
      node.classList.contains("textLayer")
    ) {
      return NodeFilter.FILTER_ACCEPT;
    }
    return NodeFilter.FILTER_SKIP;
  }

  #drawSelection() {
    const isForward = !!(
      this.#anchorNode.compareDocumentPosition(this.#focusNode) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    let range = document.createRange();
    if (isForward) {
      range.setStart(this.#anchorNode, this.#anchorOffset);
      range.setEnd(this.#anchorNode, this.#anchorNode.length);
    } else {
      range.setStart(this.#anchorNode, this.#anchorOffset);
      range.setEnd(this.#anchorNode, 0);
    }
    range.getBoundingClientRect();

    const walker = document.createTreeWalker(
      this.#anchorTextLayer,
      NodeFilter.SHOW_TEXT
    );
    let lastNode, textArea;
    if (isForward) {
      walker.currentNode = this.#anchorNode;
      lastNode = this.#focusNode;
    } else {
      walker.currentNode = this.#focusNode;
      lastNode = this.#anchorNode;
    }

    while (walker.nextNode()) {
      const { currentNode } = walker;
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        textArea = currentNode;
        continue;
      }
      if (currentNode === lastNode) {
        break;
      }
      yield currentNode.getBoundingClientRect();
    }

    range = document.createRange();
    if (isForward) {
      range.setStart(this.#focusNode, 0);
      range.setEnd(this.#focusNode, this.#focusOffset);
    } else {
      range.setStart(this.#focusNode, this.#focusOffset);
      range.setEnd(this.#focusNode, 0);
    }
    yield range.getBoundingClientRect();
  }
}

export { SelectionManager };
