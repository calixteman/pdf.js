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

import {
  DOMSVGFactory,
  noContextMenu,
  stopEvent,
  SupportedImageMimeTypes,
} from "pdfjs-lib";

class SignatureManager {
  #addButton;

  #tabsToAltText = null;

  #clearButton;

  #currentEditor;

  #description;

  #dialog;

  #drawCurves = null;

  #drawPlaceholder;

  #drawPath = null;

  #drawPathString = "";

  #drawPoints = null;

  #drawSVG;

  #drawThickness;

  #errorBar;

  #extractedSignatureData = null;

  #imagePath = null;

  #imagePicker;

  #imagePlaceholder;

  #imageSVG;

  #saveCheckbox;

  #tabButtons;

  #typePanel;

  #currentTab = null;

  #currentTabAC = null;

  #hasDescriptionChanged = false;

  #overlayManager;

  #uiManager = null;

  constructor(
    {
      dialog,
      panels,
      typeButton,
      typePanel,
      drawButton,
      drawPlaceholder,
      drawThickness,
      imageButton,
      drawSVG,
      imageSVG,
      imagePlaceholder,
      imagePicker,
      description,
      clearDescription,
      clearButton,
      cancelButton,
      addButton,
      errorCloseButton,
      errorBar,
      saveCheckbox,
    },
    overlayManager
  ) {
    this.#addButton = addButton;
    this.#clearButton = clearButton;
    this.#dialog = dialog;
    this.#description = description;
    this.#errorBar = errorBar;
    this.#saveCheckbox = saveCheckbox;
    this.#typePanel = typePanel;
    this.#drawSVG = drawSVG;
    this.#drawPlaceholder = drawPlaceholder;
    this.#drawThickness = drawThickness;
    this.#imageSVG = imageSVG;
    this.#imagePlaceholder = imagePlaceholder;
    this.#imagePicker = imagePicker;
    this.#overlayManager = overlayManager;

    dialog.addEventListener("close", this.#close.bind(this));
    dialog.addEventListener("contextmenu", event => {
      if (
        event.target !== this.#typePanel &&
        event.target !== this.#description
      ) {
        event.preventDefault();
      }
    });
    dialog.addEventListener("drop", e => {
      stopEvent(e);
    });
    cancelButton.addEventListener("click", this.#cancel.bind(this));
    addButton.addEventListener("click", this.#add.bind(this));
    clearButton.addEventListener(
      "click",
      () => {
        this.#initTab(null, true);
      },
      { passive: true }
    );
    clearDescription.addEventListener(
      "click",
      () => {
        this.#description.value = "";
      },
      { passive: true }
    );
    errorCloseButton.addEventListener(
      "click",
      () => {
        errorBar.hidden = true;
      },
      { passive: true }
    );

    this.#initTabButtons(typeButton, drawButton, imageButton, panels);
    this.#imagePicker.accept = SupportedImageMimeTypes.join(",");

    this.#overlayManager.register(dialog);
  }

  #initTabButtons(typeButton, drawButton, imageButton, panels) {
    const buttons = (this.#tabButtons = new Map([
      ["type", typeButton],
      ["draw", drawButton],
      ["image", imageButton],
    ]));
    const tabCallback = e => {
      for (const [name, button] of buttons) {
        if (button === e.target) {
          button.setAttribute("aria-selected", true);
          button.setAttribute("tabindex", 0);
          panels.setAttribute("data-selected", name);
          this.#initTab(name, false);
        } else {
          button.setAttribute("aria-selected", false);
          button.setAttribute("tabindex", -1);
        }
      }
    };

    const buttonsArray = Array.from(buttons.values());
    for (let i = 0, ii = buttonsArray.length; i < ii; i++) {
      const button = buttonsArray[i];
      button.addEventListener("click", tabCallback, { passive: true });
      button.addEventListener(
        "keydown",
        ({ key }) => {
          let target = null;
          if (key === "ArrowLeft") {
            if (i - 1 >= 0) {
              target = buttonsArray[i - 1];
            }
          } else if (key === "ArrowRight") {
            if (i + 1 < ii) {
              target = buttonsArray[i + 1];
            }
          }
          if (target) {
            target.focus();
          }
        },
        { passive: true }
      );
    }
  }

  #initTab(name, reset) {
    if (name && this.#currentTab === name) {
      return;
    }
    if (this.#currentTab) {
      this.#tabsToAltText.set(this.#currentTab, this.#description.value);
    }
    if (name) {
      this.#currentTab = name;
    }

    if (reset) {
      this.#hasDescriptionChanged = false;
      this.#description.value = "";
      this.#tabsToAltText.set(this.#currentTab, "");
    } else {
      this.#description.value = this.#tabsToAltText.get(this.#currentTab);
    }
    this.#currentTabAC?.abort();
    this.#currentTabAC = new AbortController();
    switch (this.#currentTab) {
      case "type":
        this.#initTypeTab(reset);
        break;
      case "draw":
        this.#initDrawTab(reset);
        break;
      case "image":
        this.#initImageTab(reset);
        break;
    }
  }

  #disableButtons(value) {
    this.#clearButton.disabled =
      this.#saveCheckbox.disabled =
      this.#addButton.disabled =
        !value;
  }

  #initTypeTab(reset) {
    if (reset) {
      this.#typePanel.value = "";
    }

    this.#disableButtons(this.#typePanel.value);

    const { signal } = this.#currentTabAC;
    const options = { passive: true, signal };
    this.#typePanel.addEventListener(
      "input",
      () => {
        const { value } = this.#typePanel;
        if (!this.#hasDescriptionChanged) {
          this.#description.value = value;
        }
        this.#disableButtons(value);
      },
      options
    );
    this.#description.addEventListener(
      "input",
      () => {
        this.#hasDescriptionChanged =
          this.#typePanel.value !== this.#description.value;
      },
      options
    );
  }

  #initDrawTab(reset) {
    if (reset) {
      this.#drawCurves = null;
      this.#drawPoints = null;
      this.#drawPathString = "";
      this.#drawPath?.remove();
      this.#drawPath = null;
      this.#drawPlaceholder.hidden = false;
    }

    this.#disableButtons(this.#drawPath);

    const { signal } = this.#currentTabAC;
    const options = { signal };
    let currentPointerId = NaN;
    const drawCallback = e => {
      const { pointerId } = e;
      if (!isNaN(currentPointerId) && currentPointerId !== pointerId) {
        return;
      }
      currentPointerId = pointerId;
      e.preventDefault();
      this.#drawSVG.setPointerCapture(pointerId);
      this.#saveCheckbox.disabled = false;

      const { width: drawWidth, height: drawHeight } =
        this.#drawSVG.getBoundingClientRect();
      const { offsetX, offsetY } = e;
      if (e.target === this.#drawPlaceholder) {
        this.#drawPlaceholder.hidden = true;
      }
      if (!this.#drawCurves) {
        this.#drawCurves = {
          width: drawWidth,
          height: drawHeight,
          thickness: this.#drawThickness.value,
          curves: [],
        };
      }
      if (!this.#drawPathString) {
        const svgFactory = new DOMSVGFactory();
        const path = (this.#drawPath = svgFactory.createElement("path"));
        this.#disableButtons(true);
        path.setAttribute("stroke-width", this.#drawThickness.value);
        this.#drawSVG.append(path);
        this.#drawSVG.addEventListener("pointerdown", drawCallback, { signal });
        this.#drawPlaceholder.removeEventListener("pointerdown", drawCallback);
      }

      this.#drawPoints = [offsetX, offsetY];
      this.#drawCurves.curves.push({ points: this.#drawPoints });
      this.#drawPathString += `M ${offsetX} ${offsetY}`;
      this.#drawPath.setAttribute("d", this.#drawPathString);

      const finishDrawAC = new AbortController();
      const listenerDrawOptions = {
        signal: AbortSignal.any([signal, finishDrawAC.signal]),
      };
      this.#drawSVG.addEventListener(
        "contextmenu",
        noContextMenu,
        listenerDrawOptions
      );
      this.#drawSVG.addEventListener(
        "pointermove",
        evt => {
          evt.preventDefault();
          const { offsetX: x, offsetY: y } = evt;
          if (x < 0 || y < 0 || x > drawWidth || y > drawHeight) {
            return;
          }
          const drawPoints = this.#drawPoints;
          this.#drawPoints.push(x, y);
          if (drawPoints.length >= 6) {
            const [x1, y1, x2, y2] = drawPoints.slice(-6, -2);
            this.#drawPathString += `C${(x1 + 5 * x2) / 6} ${(y1 + 5 * y2) / 6} ${(5 * x2 + x) / 6} ${(5 * y2 + y) / 6} ${(x2 + x) / 2} ${(y2 + y) / 2}`;
          } else {
            this.#drawPathString += `L${x} ${y}`;
          }
          this.#drawPath.setAttribute("d", this.#drawPathString);
        },
        listenerDrawOptions
      );
      this.#drawSVG.addEventListener(
        "pointerup",
        evt => {
          const { pointerId: pId } = evt;
          if (!isNaN(currentPointerId) && currentPointerId !== pId) {
            return;
          }
          currentPointerId = NaN;
          evt.preventDefault();
          this.#drawSVG.releasePointerCapture(pId);
          finishDrawAC.abort();
          if (this.#drawPoints.length === 2) {
            this.#drawPathString += `L${this.#drawPoints[0]} ${this.#drawPoints[1]}`;
            this.#drawPath.setAttribute("d", this.#drawPathString);
          }
        },
        { signal, once: true }
      );
    };
    if (this.#drawCurves) {
      this.#drawSVG.addEventListener("pointerdown", drawCallback, options);
    } else {
      this.#drawPlaceholder.addEventListener(
        "pointerdown",
        drawCallback,
        options
      );
    }
    this.#drawThickness.addEventListener(
      "input",
      () => {
        const { value: thickness } = this.#drawThickness;
        this.#drawThickness.setAttribute(
          "data-l10n-args",
          JSON.stringify({ thickness })
        );
        if (!this.#drawCurves) {
          return;
        }
        this.#drawPath.setAttribute("stroke-width", thickness);
        this.#drawCurves.thickness = thickness;
      },
      options
    );
  }

  #initImageTab(reset) {
    if (reset) {
      this.#imagePlaceholder.hidden = false;
      this.#imagePath?.remove();
      this.#imagePath = null;
    }

    this.#disableButtons(this.#imagePath);

    const { signal } = this.#currentTabAC;
    const options = { signal };
    this.#imagePicker.addEventListener("click", () => {
      this.#dialog.classList.toggle("waiting", true);
    });
    this.#imagePicker.addEventListener(
      "change",
      async () => {
        if (!this.#imagePicker.files?.length) {
          this.#errorBar.hidden = false;
          this.#dialog.classList.toggle("waiting", false);
          return;
        }
        const file = this.#imagePicker.files[0];
        if (!SupportedImageMimeTypes.includes(file.type)) {
          this.#errorBar.hidden = false;
          this.#dialog.classList.toggle("waiting", false);
          return;
        }
        await this.#extractSignature(
          this.#imagePicker.files[0],
          /* blur = */ true
        );
      },
      options
    );
    this.#imagePicker.addEventListener("cancel", () => {
      this.#dialog.classList.toggle("waiting", false);
    });
    this.#imagePlaceholder.addEventListener(
      "dragover",
      e => {
        for (const item of e.dataTransfer.items) {
          if (SupportedImageMimeTypes.includes(item.type)) {
            e.dataTransfer.dropEffect =
              e.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
            stopEvent(e);
            return;
          }
        }
        e.dataTransfer.dropEffect = "none";
      },
      options
    );
    this.#imagePlaceholder.addEventListener(
      "drop",
      async e => {
        const {
          dataTransfer: { files },
        } = e;
        if (!files?.length) {
          return;
        }
        let imageFile;
        for (const file of files) {
          if (SupportedImageMimeTypes.includes(file.type)) {
            imageFile = file;
            break;
          }
        }
        stopEvent(e);
        this.#dialog.classList.toggle("waiting", true);
        await this.#extractSignature(imageFile);
      },
      options
    );
  }

  async #extractSignature(file) {
    let data;
    try {
      data = await this.#uiManager.imageManager.getFromFile(file);
    } catch (e) {
      this.#errorBar.hidden = false;
      console.error("SignatureManager.initImageTab.", e);
    }
    if (!data) {
      this.#errorBar.hidden = false;
      this.#dialog.classList.toggle("waiting", false);
      return;
    }

    const outline = (this.#extractedSignatureData =
      this.#currentEditor.extractSignature(data.bitmap));

    if (!outline) {
      this.#dialog.classList.toggle("waiting", false);
      return;
    }

    this.#imagePlaceholder.hidden = true;
    this.#disableButtons(true);
    const svgFactory = new DOMSVGFactory();
    const path = (this.#imagePath = svgFactory.createElement("path"));
    this.#imageSVG.setAttribute("viewBox", outline.viewBox);
    this.#imageSVG.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.#imageSVG.append(path);
    path.setAttribute("d", outline.toSVGPath());
    if (this.#description.value === "") {
      this.#description.value = file.name;
    }
    this.#dialog.classList.toggle("waiting", false);
  }

  #getOutlineForType() {
    let canvas = new OffscreenCanvas(1, 1);
    let ctx = canvas.getContext("2d", { alpha: false });
    const { fontFamily, fontSize, fontStyle, fontWeight } =
      window.getComputedStyle(this.#typePanel);
    const font =
      (ctx.font = `${fontStyle} ${fontWeight} ${4 * parseInt(fontSize, 10)}px ${fontFamily}`);
    const text = this.#typePanel.value;
    const {
      actualBoundingBoxLeft,
      actualBoundingBoxRight,
      actualBoundingBoxAscent,
      actualBoundingBoxDescent,
      fontBoundingBoxAscent,
      fontBoundingBoxDescent,
      width,
    } = ctx.measureText(text);

    // We rescale the canvas to make "sure" the text fits.
    const SCALE = 1.5;
    const canvasWidth = Math.ceil(
      Math.max(
        Math.abs(actualBoundingBoxLeft) + Math.abs(actualBoundingBoxRight),
        width
      ) * SCALE
    );
    const canvasHeight = Math.ceil(
      Math.max(
        Math.abs(actualBoundingBoxAscent) + Math.abs(actualBoundingBoxDescent),
        Math.abs(fontBoundingBoxAscent) + Math.abs(fontBoundingBoxDescent)
      ) * SCALE
    );
    canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.font = font;
    ctx.filter = "grayscale(1)";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = ctx.strokeStyle = "black";
    ctx.fillText(
      text,
      (canvasWidth * (SCALE - 1)) / 2,
      (canvasHeight * (3 - SCALE)) / 2
    );

    return this.#currentEditor.extractSignature({
      buffer: ctx.getImageData(0, 0, canvasWidth, canvasHeight).data,
      width: canvasWidth,
      height: canvasHeight,
    });
  }

  #getOutlineForDraw() {
    const { width, height } = this.#drawSVG.getBoundingClientRect();
    return this.#currentEditor.getDrawnSignature(
      this.#drawCurves,
      width,
      height
    );
  }

  getSignature(params) {
    return this.open(params);
  }

  async open({ uiManager, editor }) {
    this.#tabsToAltText ||= new Map(
      this.#tabButtons.keys().map(name => [name, ""])
    );
    this.#uiManager = uiManager;
    this.#currentEditor = editor;
    this.#uiManager.removeEditListeners();

    await this.#overlayManager.open(this.#dialog);

    this.#tabButtons.get("type").click();
  }

  #cancel() {
    this.#finish();
  }

  #finish() {
    if (this.#overlayManager.active === this.#dialog) {
      this.#overlayManager.close(this.#dialog);
    }
  }

  #close() {
    if (this.#currentEditor.isEmpty()) {
      this.#currentEditor.remove();
    }
    if (this.#currentTab) {
      this.#tabsToAltText.set(this.#currentTab, this.#description.value);
    }
    this.#uiManager?.addEditListeners();
    this.#currentTabAC?.abort();
    this.#currentTabAC = null;
    this.#uiManager = null;
    this.#currentEditor = null;
  }

  #add() {
    switch (this.#currentTab) {
      case "type":
        this.#currentEditor.addSignature(this.#getOutlineForType(), 40);
        break;
      case "draw":
        this.#currentEditor.addSignature(this.#getOutlineForDraw(), 40);
        break;
      case "image":
        this.#currentEditor.addSignature(this.#extractedSignatureData, 40);
        break;
    }

    this.#finish();
  }

  destroy() {
    this.#uiManager = null;
    this.#finish();
  }
}

export { SignatureManager };
