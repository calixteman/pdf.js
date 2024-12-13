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

import { AnnotationEditorType } from "pdfjs-lib";

/**
 * @typedef {Object} ToolbarOptions
 * @property {HTMLDivElement} mainContainer - Main container.
 * @property {HTMLDivElement} container - Container for the toolbar.
 * @property {HTMLButtonElement} download - Button to download the document.
 *  * @property {HTMLButtonElement} draw - Button to start drawing.
 */

class Toolbar {
  #actions;

  #buttons;

  #eventBus;

  /**
   * @param {ToolbarOptions} options
   * @param {EventBus} eventBus
   * @param {Object} nimbusData - Nimbus configuration.
   */
  constructor(options, eventBus, nimbusData) {
    this.#eventBus = eventBus;
    const { actions, container } = options;
    this.#actions = actions;
    const buttons = [
      {
        element: options.download,
        eventName: "download",
        nimbusName: "download-button",
      },
      {
        element: options.draw,
        eventName: "switchannotationeditormode",
        eventDetails: {
          mode: AnnotationEditorType.INK,
        },
        action: () => {
          container.classList.add("draw");
          container.classList.remove("main");
        },
      },
      {
        element: options.back,
        eventName: "switchannotationeditormode",
        eventDetails: {
          mode: AnnotationEditorType.NONE,
        },
        action: () => {
          container.classList.value = "";
          container.classList.add("main", "show");
        },
      },
      {
        element: options.commit,
        eventName: "editingaction",
        eventDetails: {
          name: "commit",
        },
      },
      {
        element: options.delete,
        eventName: "editingaction",
        eventDetails: {
          name: "delete",
        },
      },
    ];

    if (nimbusData) {
      this.#buttons = [];
      for (const button of buttons) {
        if (nimbusData[button.nimbusName]) {
          this.#buttons.push(button);
        } else {
          button.element.remove();
        }
      }
      if (this.#buttons.length > 0) {
        container.classList.add("show");
      } else {
        container.remove();
        options.mainContainer.classList.add("noToolbar");
      }
    } else {
      container.classList.add("show");
      this.#buttons = buttons;
    }

    // Bind the event listeners for click and various other actions.
    this.#bindListeners(options);

    this.#eventBus._on(
      "annotationeditorstateschanged",
      this.#onAnnotationEditorStatesChanged.bind(this)
    );
  }

  setPageNumber(pageNumber, pageLabel) {}

  setPagesCount(pagesCount, hasPageLabels) {}

  setPageScale(pageScaleValue, pageScale) {}

  reset() {}

  #bindListeners(options) {
    // The buttons within the toolbar.
    for (const { element, eventName, eventDetails, action } of this.#buttons) {
      element.addEventListener("click", evt => {
        if (eventName !== null) {
          this.#eventBus.dispatch(eventName, { source: this, ...eventDetails });
          this.#eventBus.dispatch("reporttelemetry", {
            source: this,
            details: {
              type: "gv-buttons",
              data: { id: `${element.id}_tapped` },
            },
          });
        }
        action?.();
      });
    }
  }

  updateLoadingIndicatorState(loading = false) {}

  #onAnnotationEditorStatesChanged({
    details: { hasSelectedEditor, hasSomethingToCommit },
  }) {
    if (typeof hasSelectedEditor === "boolean") {
      this.#actions.classList.toggle("hasSelectedEditor", hasSelectedEditor);
    }
    if (typeof hasSomethingToCommit === "boolean") {
      this.#actions.classList.toggle(
        "hasSomethingToCommit",
        hasSomethingToCommit
      );
    }
  }
}

export { Toolbar };
