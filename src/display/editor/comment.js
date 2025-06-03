/* Copyright 2023 Mozilla Foundation
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

import { noContextMenu } from "../display_utils.js";

class Comment {
  #commentButton = null;

  #commentWasFromKeyBoard = false;

  #editor = null;

  #text = "";

  #date = null;

  constructor(editor) {
    this.#editor = editor;
    this.toolbar = null;
  }

  render() {
    const comment = (this.#commentButton = document.createElement("button"));
    comment.className = "comment";
    comment.tabIndex = "0";
    comment.setAttribute("data-l10n-id", "pdfjs-editor-comment-button");

    const label = document.createElement("span");
    label.setAttribute("data-l10n-id", "pdfjs-editor-comment-button-label");
    comment.append(label);

    const signal = this.#editor._uiManager._signal;
    comment.addEventListener("contextmenu", noContextMenu, { signal });
    comment.addEventListener("pointerdown", event => event.stopPropagation(), {
      signal,
    });

    const onClick = event => {
      event.preventDefault();
      const position = this.toolbar.getPosition();
      this.#editor._uiManager.editComment(this.#editor, position);
    };
    comment.addEventListener("click", onClick, { capture: true, signal });
    comment.addEventListener(
      "keydown",
      event => {
        if (event.target === comment && event.key === "Enter") {
          this.#commentWasFromKeyBoard = true;
          onClick(event);
        }
      },
      { signal }
    );

    return comment;
  }

  finish() {
    if (!this.#commentButton) {
      return;
    }
    this.#commentButton.focus({ focusVisible: this.#commentWasFromKeyBoard });
    this.#commentWasFromKeyBoard = false;
  }

  isEmpty() {
    return this.#text === "";
  }

  hasData() {
    return this.isEmpty();
  }

  serialize() {
    return this.data;
  }

  get data() {
    return {
      text: this.#text,
      date: this.#date,
    };
  }

  /**
   * Set the alt text data.
   */
  set data(text) {
    this.#text = text ?? "";
    this.#date = new Date();
  }

  toggle(enabled = false) {
    if (!this.#commentButton) {
      return;
    }
    this.#commentButton.disabled = !enabled;
  }

  shown() {}

  destroy() {
    this.#commentButton?.remove();
    this.#commentButton = null;
    this.#text = "";
    this.#date = null;
    this.#editor = null;
    this.#commentWasFromKeyBoard = false;
  }
}

export { Comment };
