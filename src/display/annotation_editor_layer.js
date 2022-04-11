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

import { fitCurve } from "./bezier_approx.js";
import { PixelsPerInch } from "./display_utils.js";
import { Util } from "../shared/util.js";

function bindEvents(obj, element, names) {
  for (const name of names) {
    element.addEventListener(name, obj[name].bind(obj));
  }
}

/**
 * Class to create some unique ids for the different editors.
 */
class IdManager {
  #id;

  constructor() {
    this.#id = 0;
  }

  /**
   * Get a unique id.
   * @returns {string}
   */
  getId() {
    return `editor${this.#id++}`;
  }
}

/**
 * Class to handle undo/redo.
 * Commands are just saved in a buffer.
 * If we hit some memory issues we could likely use a circular buffer.
 * It has to be used as a singleton.
 */
class CommandManager {
  constructor() {
    this.commands = [];
    this.position = -1;
  }

  /**
   * Add a new couple of commands to be used in case of redo/undo.
   * @param {function} cmd
   * @param {function} undo
   */
  add(cmd, undo) {
    const save = [cmd, undo];
    if (this.position !== this.commands.length - 1) {
      this.commands.splice(
        ++this.position,
        this.commands.length - this.position,
        save
      );
    } else {
      this.commands.push(save);
      this.position++;
    }
    cmd();
  }

  /**
   * Undo the last command.
   */
  undo() {
    if (this.position !== -1) {
      this.commands[this.position--][1]();
    }
  }

  /**
   * Redo the last command.
   */
  redo() {
    if (this.position !== this.commands.length - 1) {
      this.commands[++this.position][0]();
    }
  }
}

/**
 * Class to handle the different keyboards shortcuts we can have on mac or
 * non-mac OSes.
 */
class KeyboardManager {
  /**
   * Create a new keyboard manager class.
   * @param {Array<Array>} callbacks - an array containing an array of shortcuts
   * and a callback to call.
   * A shortcut is a string like `ctrl+c` or `mac+ctrl+c` for mac OS.
   */
  constructor(callbacks) {
    this.buffer = [];
    this.callbacks = new Map();
    this.allKeys = new Set();

    const isMac =
      navigator.platform.indexOf("Mac") === 0 ||
      navigator.platform === "iPhone";
    for (const [keys, callback] of callbacks) {
      for (const key of keys) {
        const isMacKey = key.startsWith("mac+");
        if (isMac && isMacKey) {
          this.callbacks.set(key.slice(4), callback);
          this.allKeys.add(key.split("+").at(-1));
        } else if (!isMac && !isMacKey) {
          this.callbacks.set(key, callback);
          this.allKeys.add(key.split("+").at(-1));
        }
      }
    }
  }

  /**
   * Serialize an event into a string in order to match a
   * potential key for a callback.
   * @param {KeyboardEvent} event
   * @returns {string}
   */
  #serialize(event) {
    if (event.altKey) {
      this.buffer.push("alt");
    }
    if (event.ctrlKey) {
      this.buffer.push("ctrl");
    }
    if (event.metaKey) {
      this.buffer.push("meta");
    }
    if (event.shiftKey) {
      this.buffer.push("shift");
    }
    this.buffer.push(event.key);
    const str = this.buffer.join("+");
    this.buffer.length = 0;

    return str;
  }

  /**
   * Execute a callback, if any, for a given keyboard event.
   * The page is used as `this` in the callback.
   * @param {AnnotationEditorLayer} page.
   * @param {KeyboardEvent} event
   * @returns
   */
  exec(page, event) {
    if (!this.allKeys.has(event.key)) {
      return;
    }
    const callback = this.callbacks.get(this.#serialize(event));
    if (!callback) {
      return;
    }
    callback.bind(page)();
    event.preventDefault();
  }
}

/**
 * Basic clipboard to copy/paste some editors.
 * It has to be used as a singleton.
 */
class ClipboardManager {
  constructor() {
    this.element = null;
  }

  /**
   * Copy an element.
   * @param {AnnotationEditor} element
   */
  copy(element) {
    this.element = element.copy();
  }

  /**
   * Create a new element.
   * @returns {AnnotationEditor|null}
   */
  paste() {
    return this.element?.copy() || null;
  }
}

/**
 * Base class for editors.
 */
class AnnotationEditor {
  #isInEditMode;

  /**
   * @param {AnnotationEditorLayer} parent - the layer containing this editor
   * @param {string} id - editor id
   * @param {number} x - x-coordinate
   * @param {number} y - y-coordinate
   */
  constructor({ parent, id, x, y, name }) {
    this.parent = parent;
    this.id = id;
    this.width = this.height = null;
    this.pageIndex = parent.pageIndex;
    this.name = name;
    this.div = null;
    this.x = Math.round(x);
    this.y = Math.round(y);

    this.isAttachedToDOM = false;
    this.#isInEditMode = false;
  }

  /**
   * onfocus callback.
   */
  focusin(/* event */) {
    this.parent.setActiveEditor(this);
  }

  /**
   * onblur callback.
   * @param {BlurEvent} event
   * @returns {undefined}
   */
  focusout(event) {
    if (!this.isAttachedToDOM) {
      return;
    }

    // In case of focusout, the relatedTarget is the element which
    // is grabbing the focus.
    // So if the related target is an element under the div for this
    // editor, then the editor isn't unactive.
    const target = event.relatedTarget;
    if (target?.closest(`#${this.id}`)) {
      return;
    }

    event.preventDefault();

    if (this.isEmpty()) {
      this.remove();
    } else {
      this.commit();
    }
    this.parent.setActiveEditor(null);
  }

  /**
   * Get the pointer coordinates in order to correctly translate the
   * div in case of drag-and-drop.
   * @param {MouseEvent} event
   */
  mousedown(event) {
    this.mouseX = event.offsetX;
    this.mouseY = event.offsetY;
  }

  /**
   * We use drag-and-drop in order to move an editor on a page.
   * @param {DragEvent} event
   */
  dragstart(event) {
    event.dataTransfer.setData("text/plain", this.id);
    event.dataTransfer.effectAllowed = "move";
  }

  /**
   * Set the editor position within its parent.
   * @param {number} x
   * @param {number} y
   */
  setAt(x, y) {
    this.x = Math.round(x);
    this.y = Math.round(y);

    this.div.style.left = `${this.x}px`;
    this.div.style.top = `${this.y}px`;
  }

  /**
   * Translate the editor position within its parent.
   * @param {number} x
   * @param {number} y
   */
  translate(x, y) {
    this.setAt(this.x + x, this.y + y);
  }

  /**
   * Set the dimensions of this editor.
   * @param {number} width
   * @param {number} height
   */
  setDims(width, height) {
    this.div.style.width = `${width}px`;
    this.div.style.height = `${height}px`;
  }

  /**
   * Render this editor in a div.
   * @returns {HTMLDivElement}
   */
  render() {
    this.div = document.createElement("div");
    this.div.className = this.name;
    this.div.setAttribute("id", this.id);
    this.div.draggable = true;
    this.div.tabIndex = 100;
    this.div.style.left = `${this.x}px`;
    this.div.style.top = `${this.y}px`;

    bindEvents(this, this.div, [
      "dragstart",
      "focusin",
      "focusout",
      "mousedown",
    ]);

    return this.div;
  }

  /**
   * Executed once this editor has been rendered.
   */
  onceAdded() {}

  /**
   * Apply the current transform (zoom) to this editor.
   * @param {Array<number>} transform
   */
  transform(transform) {
    const { style } = this.div;
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);

    const [x1, y1] = Util.applyTransform([this.x, this.y], transform);

    if (!Number.isNaN(width)) {
      const [x2] = Util.applyTransform([this.x + width, 0], transform);
      this.div.style.width = `${x2 - x1}px`;
    }
    if (!Number.isNaN(height)) {
      const [, y2] = Util.applyTransform([0, this.y + height], transform);
      this.div.style.height = `${y2 - y1}px`;
    }
    this.setAt(x1, y1);
  }

  /**
   * Check if the editor contains something.
   * @returns {boolean}
   */
  isEmpty() {
    return false;
  }

  /**
   * Enable edit mode.
   * @returns {undefined}
   */
  enableEditMode() {
    this.#isInEditMode = true;
  }

  /**
   * Disable edit mode.
   * @returns {undefined}
   */
  disableEditMode() {
    this.#isInEditMode = false;
  }

  /**
   * Check if the editor is edited.
   * @returns {boolean}
   */
  isInEditMode() {
    return this.#isInEditMode;
  }

  /**
   * If it returns true, then this editor handle the keyboard
   * events itself.
   * @returns {boolean}
   */
  shouldGetKeyboardEvents() {
    return false;
  }

  /**
   * Copy the elements of an editor in order to be able to build
   * a new one from these data.
   * It's used on ctrl+c action.
   *
   * To implement in subclasses.
   * @returns {AnnotationEditor}
   */
  copy() {
    throw new Error("An editor must be copyable");
  }

  /**
   * Check if this editor needs to be rebuilt or not.
   * @returns {boolean}
   */
  needsToBeRebuilt() {
    return this.div && !this.isAttachedToDOM;
  }

  /**
   * Rebuild the editor in case it has been removed on undo.
   *
   * To implement in subclasses.
   * @returns {undefined}
   */
  rebuild() {
    throw new Error("An editor must be rebuildable");
  }

  /**
   * Serialize the editor.
   * The result of the serialization will be used to construct a
   * new annotation to add to the pdf document.
   *
   * To implement in subclasses.
   * @returns {undefined}
   */
  serialize() {
    throw new Error("An editor must be serializable");
  }

  /**
   * Remove this editor.
   * It's used on ctrl+backspace action.
   *
   * @returns {undefined}
   */
  remove() {
    this.parent.remove(this);
  }
}

/**
 * Basic draw editor in order to generate an Ink annotation.
 */
class InkEditor extends AnnotationEditor {
  #aspectRatio;

  #baseHeight;

  #baseWidth;

  #boundCanvasMousemove;

  #boundCanvasMouseleave;

  #boundCanvasMouseup;

  #boundCanvasMousedown;

  #disableEditing;

  constructor(params) {
    super({ ...params, name: "inkEditor" });
    this.color = params.color || "CanvasText";
    this.thickness = params.thickness || 1;
    this.paths = [];
    this.bezierPath2D = [];
    this.currentPath = [];
    this.scaleFactor = 1;
    this.translationX = this.translationY = 0;
    this.#baseWidth = this.#baseHeight = 0;
    this.#aspectRatio = 0;
    this.#disableEditing = false;

    this.#boundCanvasMousemove = this.canvasMousemove.bind(this);
    this.#boundCanvasMouseleave = this.canvasMouseleave.bind(this);
    this.#boundCanvasMouseup = this.canvasMouseup.bind(this);
    this.#boundCanvasMousedown = this.canvasMousedown.bind(this);
  }

  /** @inheritdoc */
  copy() {
    const editor = new InkEditor({
      parent: this.parent,
      id: this.parent.getNextId(),
      x: this.x,
      y: this.y,
    });

    editor.width = this.width;
    editor.height = this.height;
    editor.color = this.color;
    editor.thickness = this.thickness;
    editor.paths = this.paths.slice();
    editor.bezierPath2D = this.bezierPath2D.slice();
    editor.scaleFactor = this.scaleFactor;
    editor.translationX = this.translationX;
    editor.translationY = this.translationY;
    editor.#aspectRatio = this.#aspectRatio;
    editor.#baseWidth = this.#baseWidth;
    editor.#baseHeight = this.#baseHeight;
    editor.#disableEditing = this.#disableEditing;

    return editor;
  }

  /** @inheritdoc */
  rebuild() {
    if (this.div === null) {
      return;
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor has been removed and
      // we're rebuilting it, hence we must add it to its
      // parent.
      this.parent.add(this);
      this.#setCanvasDims();
    }
    this.#fitToContent();
  }

  /** @inheritdoc */
  remove() {
    super.remove();

    // Destroy the canvas.
    this.canvas.width = this.canvas.heigth = 0;
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.#disableEditing) {
      return;
    }

    super.enableEditMode();
    this.canvas.style.cursor = "pointer";
    this.div.draggable = false;
    this.canvas.addEventListener("mousedown", this.#boundCanvasMousedown);
    this.canvas.addEventListener("mouseup", this.#boundCanvasMouseup);
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }

    super.disableEditMode();
    this.canvas.style.cursor = "auto";
    this.div.draggable = true;

    this.canvas.removeEventListener("mousedown", this.#boundCanvasMousedown);
    this.canvas.removeEventListener("mouseup", this.#boundCanvasMouseup);
  }

  /** @inheritdoc */
  onceAdded() {
    this.div.focus();
  }

  /** @inheritdoc */
  isEmpty() {
    return this.paths.length === 0;
  }

  /**
   * Set line styles.
   */
  #setStroke() {
    this.ctx.lineWidth =
      (this.thickness * this.parent.scaleFactor) / this.scaleFactor;
    this.ctx.lineCap = "butt";
    this.ctx.lineJoin = "miter";
    this.ctx.miterLimit = 10;
    this.ctx.strokeStyle = this.color;
  }

  /**
   * Start to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #startDrawing(x, y) {
    this.currentPath.push([x, y]);
    this.#setStroke();
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  /**
   * Draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #draw(x, y) {
    this.currentPath.push([x, y]);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
  }

  /**
   * Stop to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #stopDrawing(x, y) {
    this.currentPath.push([x, y]);

    // Interpolate the path entered by the user with some
    // Bezier's curves in order to have a smoother path and
    // to reduce the data size used to draw it in the PDF.
    let bezier;
    if (
      this.currentPath.length !== 2 ||
      this.currentPath[0][0] !== x ||
      this.currentPath[0][1] !== y
    ) {
      bezier = fitCurve(this.currentPath, 30);
    } else {
      // We have only one point finally.
      const xy = [x, y];
      bezier = [[xy, xy.slice(), xy.slice(), xy]];
    }
    const path2D = this.buildPath2D(bezier);
    this.currentPath.length = 0;

    const cmd = () => {
      this.paths.push(bezier);
      this.bezierPath2D.push(path2D);
      this.rebuild();
    };

    const undo = () => {
      this.paths.pop();
      this.bezierPath2D.pop();
      if (this.paths.length === 0) {
        this.remove();
      } else {
        this.#fitToContent();
      }
    };

    this.parent.addCommands(cmd, undo);
  }

  /**
   * Redraw all the paths.
   */
  #redraw() {
    this.#setStroke();

    if (this.isEmpty()) {
      this.updateTransform();
      return;
    }

    const { ctx, height, width } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.updateTransform();
    for (const path of this.bezierPath2D) {
      ctx.stroke(path);
    }
  }

  /**
   * Commit the curves we have in this editor.
   * @returns {undefined}
   */
  commit() {
    if (this.#disableEditing) {
      return;
    }
    this.disableEditMode();

    this.#disableEditing = true;
    this.div.classList.add("disabled");

    this.#fitToContent();
  }

  /** @inheritdoc */
  focusin(/* event */) {
    super.focusin();
    this.enableEditMode();
  }

  /**
   * onmousedown callback for the canvas we're drawing on.
   * @param {MouseEvent} event
   * @returns {undefined}
   */
  canvasMousedown(event) {
    if (!this.isInEditMode() || this.#disableEditing) {
      return;
    }

    event.stopPropagation();

    this.canvas.addEventListener("mouseleave", this.#boundCanvasMouseleave);
    this.canvas.addEventListener("mousemove", this.#boundCanvasMousemove);

    this.#startDrawing(event.offsetX, event.offsetY);
  }

  /**
   * onmousemove callback for the canvas we're drawing on.
   * @param {MouseEvent} event
   * @returns {undefined}
   */
  canvasMousemove(event) {
    event.stopPropagation();
    this.#draw(event.offsetX, event.offsetY);
  }

  /**
   * onmouseup callback for the canvas we're drawing on.
   * @param {MouseEvent} event
   * @returns {undefined}
   */
  canvasMouseup(event) {
    if (this.isInEditMode() && this.currentPath.length !== 0) {
      event.stopPropagation();
      this.#endDrawing(event);
    }
  }

  /**
   * onmouseleave callback for the canvas we're drawing on.
   * @param {MouseEvent} event
   * @returns {undefined}
   */
  canvasMouseleave(event) {
    this.#endDrawing(event);
  }

  /**
   * End the drawing.
   * @param {MouseEvent} event
   */
  #endDrawing(event) {
    this.#stopDrawing(event.offsetX, event.offsetY);

    this.canvas.removeEventListener("mouseleave", this.#boundCanvasMouseleave);
    this.canvas.removeEventListener("mousemove", this.#boundCanvasMousemove);
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    super.render();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "inkEditorCanvas";
    this.div.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    if (this.width) {
      // This editor has been created in using copy (ctrl+c).
      this.setAt(this.x + this.width, this.y + this.height);
      this.setDims(this.width, this.height);
      this.#setCanvasDims();
      this.#redraw();
    }

    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.setDimensions(rect.width, rect.height);
      }
    });
    observer.observe(this.div);

    return this.div;
  }

  #setCanvasDims() {
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.updateTransform();
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  setDimensions(width, height) {
    if (this.width === width && this.height === height) {
      return;
    }

    this.canvas.style.visibility = "hidden";

    if (this.#aspectRatio) {
      height = Math.ceil(width / this.#aspectRatio);
      this.div.style.height = `${height}px`;
    }

    this.width = width;
    this.height = height;

    if (this.#disableEditing) {
      const padding = this.#getPadding();
      const scaleFactorW = (width - padding) / this.#baseWidth;
      const scaleFactorH = (height - padding) / this.#baseHeight;
      this.scaleFactor = Math.min(scaleFactorW, scaleFactorH);
    }

    this.#setCanvasDims();
    this.#redraw();

    this.canvas.style.visibility = "visible";
  }

  updateTransform() {
    const padding = this.#getPadding() / 2;
    this.ctx.setTransform(
      this.scaleFactor,
      0,
      0,
      this.scaleFactor,
      this.translationX * this.scaleFactor + padding,
      this.translationY * this.scaleFactor + padding
    );
  }

  buildPath2D(bezier) {
    const path2D = new Path2D();
    for (let i = 0, ii = bezier.length; i < ii; i++) {
      const [first, control1, control2, second] = bezier[i];
      if (i === 0) {
        path2D.moveTo(...first);
      }
      path2D.bezierCurveTo(
        control1[0],
        control1[1],
        control2[0],
        control2[1],
        second[0],
        second[1]
      );
    }
    return path2D;
  }

  /**
   * Transform and serialize the paths.
   * @param {number} s - scale factor
   * @param {number} tx - abscissa of the translation
   * @param {number} ty - ordinate of the translation
   * @param {number} h - height of the bounding box
   */
  serializePaths(s, tx, ty, h) {
    const NUMBER_OF_POINTS_ON_BEZIER_CURVE = 4;
    const paths = [];
    const padding = this.thickness / 2;
    let buffer, points;

    for (const bezier of this.paths) {
      buffer = [];
      points = [];
      for (let i = 0, ii = bezier.length; i < ii; i++) {
        const [first, control1, control2, second] = bezier[i];
        const p10 = s * (first[0] + tx) + padding;
        const p11 = h - s * (first[1] + ty) - padding;
        const p20 = s * (control1[0] + tx) + padding;
        const p21 = h - s * (control1[1] + ty) - padding;
        const p30 = s * (control2[0] + tx) + padding;
        const p31 = h - s * (control2[1] + ty) - padding;
        const p40 = s * (second[0] + tx) + padding;
        const p41 = h - s * (second[1] + ty) - padding;

        if (i === 0) {
          buffer.push(p10, p11);
          points.push(p10, p11);
        }
        buffer.push(p20, p21, p30, p31, p40, p41);
        this.#extractPointsOnBezier(
          p10,
          p11,
          p20,
          p21,
          p30,
          p31,
          p40,
          p41,
          NUMBER_OF_POINTS_ON_BEZIER_CURVE,
          points
        );
      }
      paths.push({ bezier: buffer, points });
    }

    return paths;
  }

  /**
   * Extract n-1 points from the cubic Bezier curve.
   * @param {number} p10
   * @param {number} p11
   * @param {number} p20
   * @param {number} p21
   * @param {number} p30
   * @param {number} p31
   * @param {number} p40
   * @param {number} p41
   * @param {number} n
   * @param {Array<number>} points
   * @returns {undefined}
   */
  #extractPointsOnBezier(p10, p11, p20, p21, p30, p31, p40, p41, n, points) {
    // If we can few points thanks to the flatness we must do it.
    if (this.#isAlmostFlat(p10, p11, p20, p21, p30, p31, p40, p41)) {
      points.push(p40, p41);
      return;
    }

    // Apply the de Casteljau's algorithm in order to get n points belonging
    // to the Bezier's curve:
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm

    // The first point is the last point of the previous Bezier curve
    // so no need to push the firt point.
    for (let i = 1; i < n - 1; i++) {
      const t = i / n;
      const mt = 1 - t;

      let q10 = t * p10 + mt * p20;
      let q11 = t * p11 + mt * p21;

      let q20 = t * p20 + mt * p30;
      let q21 = t * p21 + mt * p31;

      const q30 = t * p30 + mt * p40;
      const q31 = t * p31 + mt * p41;

      q10 = t * q10 + mt * q20;
      q11 = t * q11 + mt * q21;

      q20 = t * q20 + mt * q30;
      q21 = t * q21 + mt * q31;

      q10 = t * q10 + mt * q20;
      q11 = t * q11 + mt * q21;

      points.push(q10, q11);
    }

    points.push(p40, p41);
  }

  /**
   * Check if a cubic Bezier curve is almost flat.
   * @param {number} p10
   * @param {number} p11
   * @param {number} p20
   * @param {number} p21
   * @param {number} p30
   * @param {number} p31
   * @param {number} p40
   * @param {number} p41
   * @returns {boolean}
   */
  #isAlmostFlat(p10, p11, p20, p21, p30, p31, p40, p41) {
    // For reference:
    //   https://jeremykun.com/tag/bezier-curves/
    const tol = 10;

    const ax = (3 * p20 - 2 * p10 - p40) ** 2;
    const ay = (3 * p21 - 2 * p11 - p41) ** 2;
    const bx = (3 * p30 - p10 - 2 * p40) ** 2;
    const by = (3 * p31 - p11 - 2 * p41) ** 2;

    return Math.max(ax, bx) + Math.max(ay, by) <= tol;
  }

  /**
   * Get the bounding box containing all the paths.
   * @returns {Array<number>}
   */
  #getBbox() {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    for (const path of this.paths) {
      for (const [first, control1, control2, second] of path) {
        const bbox = Util.bezierBoundingBox(
          ...first,
          ...control1,
          ...control2,
          ...second
        );
        xMin = Math.min(xMin, bbox[0]);
        yMin = Math.min(yMin, bbox[1]);
        xMax = Math.max(xMax, bbox[2]);
        yMax = Math.max(yMax, bbox[3]);
      }
    }

    return [xMin, yMin, xMax, yMax];
  }

  /**
   * The bounding box is computed with null thickness, so we must take
   * it into account for the display.
   * It corresponds to the total padding, hence it should be divided by 2
   * in order to have left/right paddings.
   * @returns {number}
   */
  #getPadding() {
    return Math.ceil(this.thickness * this.parent.scaleFactor);
  }

  /**
   * Set the div position and dimensions in order to fit to
   * the bounding box of the contents.
   * @returns {undefined}
   */
  #fitToContent() {
    if (this.isEmpty()) {
      return;
    }

    if (!this.#disableEditing) {
      this.#redraw();
      return;
    }

    const bbox = this.#getBbox();
    const padding = this.#getPadding();
    this.#baseWidth = bbox[2] - bbox[0];
    this.#baseHeight = bbox[3] - bbox[1];

    const width = Math.ceil(padding + this.#baseWidth * this.scaleFactor);
    const height = Math.ceil(padding + this.#baseHeight * this.scaleFactor);

    this.width = width;
    this.height = height;

    this.#aspectRatio = width / height;

    const prevTranslationX = this.translationX;
    const prevTranslationY = this.translationY;

    this.translationX = -bbox[0];
    this.translationY = -bbox[1];
    this.#setCanvasDims();
    this.#redraw();

    this.setDims(width, height);
    this.translate(
      prevTranslationX - this.translationX,
      prevTranslationY - this.translationY
    );
  }

  /** @inheritdoc */
  serialize() {
    const rect = this.div.getBoundingClientRect();
    const [x1, y1] = Util.applyTransform(
      [this.x, this.y + rect.height],
      this.parent.viewport.inverseTransform
    );

    const [x2, y2] = Util.applyTransform(
      [this.x + rect.width, this.y],
      this.parent.viewport.inverseTransform
    );

    return {
      type: "Ink",
      color: [0, 0, 0],
      thickness: this.thickness,
      paths: this.serializePaths(
        this.scaleFactor / this.parent.scaleFactor,
        this.translationX,
        this.translationY,
        y2 - y1
      ),
      value: this.content,
      pageIndex: this.parent.pageIndex,
      fontSize: this.fontSize,
      rect: [x1, y1, x2, y2],
    };
  }
}

/**
 * Basic text editor in order to create a FreeTex annotation.
 */
class FreeTextEditor extends AnnotationEditor {
  #color;

  #content;

  #contentHTML;

  #fontSize;

  constructor(params) {
    super({ ...params, name: "freeTextEditor" });
    this.#color = params.color || "CanvasText";
    this.#fontSize = params.fontSize || 10;
    this.#content = "";
    this.#contentHTML = "";
  }

  /** @inheritdoc */
  copy() {
    const editor = new FreeTextEditor({
      parent: this.parent,
      id: this.parent.getNextId(),
      x: this.x,
      y: this.y,
    });

    editor.width = this.width;
    editor.height = this.height;
    editor.#color = this.#color;
    editor.#fontSize = this.#fontSize;
    editor.#content = this.#content;
    editor.#contentHTML = this.#contentHTML;

    return editor;
  }

  /** @inheritdoc */
  rebuild() {
    if (this.div === null) {
      return;
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor has been removed and
      // we're rebuilting it, hence we must add it to its
      // parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  enableEditMode() {
    super.enableEditMode();
    this.overlayDiv.classList.remove("enabled");
    this.div.draggable = false;
  }

  /** @inheritdoc */
  disableEditMode() {
    super.disableEditMode();
    this.overlayDiv.classList.add("enabled");
    this.div.draggable = true;
  }

  /** @inheritdoc */
  onceAdded() {
    if (this.width) {
      // The editor has been created in using ctrl+c.
      this.div.focus();
      return;
    }
    this.enableEditMode();
    this.editorDiv.focus();
  }

  /** @inheritdoc */
  isEmpty() {
    return this.editorDiv.innerText.trim() === "";
  }

  /**
   * Extract the text from this editor.
   * @returns {string}
   */
  #extractText() {
    const divs = this.editorDiv.getElementsByTagName("div");
    if (divs.length === 0) {
      return this.editorDiv.innerText;
    }
    const buffer = [];
    for (let i = 0, ii = divs.length; i < ii; i++) {
      const div = divs[i];
      const first = div.firstChild;
      if (first?.nodeName === "#text") {
        buffer.push(first.data);
      } else {
        buffer.push("");
      }
    }
    return buffer.join("\n");
  }

  /**
   * Commit the content we have in this editor.
   * @returns {undefined}
   */
  commit() {
    this.disableEditMode();
    this.#contentHTML = this.editorDiv.innerHTML;
    this.#content = this.#extractText().trimEnd();

    const style = getComputedStyle(this.div);
    this.width = parseFloat(style.width);
    this.height = parseFloat(style.height);
  }

  /** @inheritdoc */
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }

  /**
   * ondblclick callback.
   * @param {MouseEvent} event
   */
  dblclick(event) {
    this.enableEditMode();
    this.editorDiv.focus();
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    super.render();
    this.editorDiv = document.createElement("div");
    this.editorDiv.tabIndex = 0;
    this.editorDiv.className = "internal";
    this.editorDiv.contentEditable = true;

    const { style } = this.editorDiv;
    style.fontSize = `calc(${this.#fontSize}px * var(--zoom-factor))`;
    style.minHeight = `calc(${1.5 * this.#fontSize}px * var(--zoom-factor))`;
    style.color = this.#color;

    this.div.appendChild(this.editorDiv);

    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.div.appendChild(this.overlayDiv);

    // TODO: implement paste callback.
    // The goal to sanitize and have something suitable for this
    // editor.
    bindEvents(this, this.div, ["dblclick"]);

    if (this.width) {
      // This editor has been created in using copy (ctrl+c).
      this.setAt(this.x + this.width, this.y + this.height);
      // eslint-disable-next-line no-unsanitized/property
      this.editorDiv.innerHTML = this.#contentHTML;
    }

    return this.div;
  }

  /** @inheritdoc */
  serialize() {
    const rect = this.div.getBoundingClientRect();
    const [x1, y1] = Util.applyTransform(
      [this.x, this.y + rect.height],
      this.parent.viewport.inverseTransform
    );

    const [x2, y2] = Util.applyTransform(
      [this.x + rect.width, this.y],
      this.parent.viewport.inverseTransform
    );

    return {
      type: "FreeText",
      color: [0, 0, 0],
      fontSize: this.#fontSize,
      value: this.#content,
      pageIndex: this.parent.pageIndex,
      rect: [x1, y1, x2, y2],
    };
  }
}

class AnnotationEditorLayer {
  #boundClick;

  static _activeEditor = null;

  static _allEditors = new Map();

  static _allowClick = true;

  static _clipboardManager = new ClipboardManager();

  static _commandManager = new CommandManager();

  static _currentEditorClass = null;

  static _currentEditorType = null;

  static _idManager = new IdManager();

  static _isAllSelected = false;

  static _keyboardManager = new KeyboardManager([
    [["ctrl+a", "mac+meta+a"], AnnotationEditorLayer.prototype.selectAll],
    [
      ["ctrl+shift+A", "mac+alt+meta+æ"],
      AnnotationEditorLayer.prototype.unselectAll,
    ],
    [["ctrl+c", "mac+meta+c"], AnnotationEditorLayer.prototype.copy],
    [["ctrl+v", "mac+meta+v"], AnnotationEditorLayer.prototype.paste],
    [["ctrl+x", "mac+meta+x"], AnnotationEditorLayer.prototype.cut],
    [["ctrl+z", "mac+meta+z"], AnnotationEditorLayer.prototype.undo],
    [["ctrl+y", "mac+meta+shift+Z"], AnnotationEditorLayer.prototype.redo],
    [
      [
        "ctrl+Backspace",
        "mac+Backspace",
        "mac+ctrl+Backspace",
        "mac+alt+Backspace",
      ],
      AnnotationEditorLayer.prototype.suppress,
    ],
  ]);

  constructor({ div, enabled, annotationStorage, pageIndex }) {
    this.annotationStorage = annotationStorage;
    this.pageIndex = pageIndex;
    this.div = div;
    this.#boundClick = this.click.bind(this);
    this._editors = new Map();

    for (const editor of AnnotationEditorLayer._allEditors.values()) {
      if (editor.pageIndex === pageIndex) {
        this.add(editor);
      }
    }

    if (enabled) {
      this.enable();
    } else {
      this.disable();
    }
  }

  static toggleEditorType(type) {
    if (this._activeEditor) {
      this._activeEditor.parent.setActiveEditor(null);
    }
    this._allowClick = true;

    if (type === this._currentEditorType) {
      this._currentEditorClass = this._currentEditorType = null;
      return false;
    }
    switch (type) {
      case "FreeText":
        this._currentEditorClass = FreeTextEditor;
        break;
      case "Ink":
        this._currentEditorClass = InkEditor;
        break;
      default:
        this._currentEditorClass = null;
    }
    this._currentEditorType = type;

    return true;
  }

  /**
   * Add some commands into the CommandManager (undo/redo stuff).
   * @param {function} cmd
   * @param {function} undo
   */
  addCommands(cmd, undo) {
    AnnotationEditorLayer._commandManager.add(cmd, undo);
  }

  /**
   * Undo the last command.
   */
  undo() {
    AnnotationEditorLayer._commandManager.undo();
  }

  /**
   * Redo the last command.
   */
  redo() {
    AnnotationEditorLayer._commandManager.redo();
  }

  /**
   * Suppress the selected editor or all editors.
   * @returns {undefined}
   */
  suppress() {
    let cmd, undo;
    if (AnnotationEditorLayer._isAllSelected) {
      const editors = Array.from(AnnotationEditorLayer._allEditors.values());
      cmd = () => {
        for (const editor of editors) {
          editor.remove();
        }
      };

      undo = () => {
        for (const editor of editors) {
          this.#addOrRebuild(editor);
        }
      };

      this.addCommands(cmd, undo);
    } else {
      if (!AnnotationEditorLayer._activeEditor) {
        return;
      }
      const editor = AnnotationEditorLayer._activeEditor;
      cmd = () => {
        editor.remove();
      };
      undo = () => {
        this.#addOrRebuild(editor);
      };
    }

    this.addCommands(cmd, undo);
  }

  /**
   * Copy the selected editor.
   */
  copy() {
    if (AnnotationEditorLayer._activeEditor) {
      AnnotationEditorLayer._clipboardManager.copy(
        AnnotationEditorLayer._activeEditor
      );
    }
  }

  /**
   * Cut the selected editor.
   */
  cut() {
    if (AnnotationEditorLayer._activeEditor) {
      AnnotationEditorLayer._clipboardManager.copy(
        AnnotationEditorLayer._activeEditor
      );
      const editor = AnnotationEditorLayer._activeEditor;
      const cmd = () => {
        editor.remove();
      };
      const undo = () => {
        this.#addOrRebuild(editor);
      };

      this.addCommands(cmd, undo);
    }
  }

  /**
   * Paste a previously copied editor.
   * @returns {undefined}
   */
  paste() {
    const editor = AnnotationEditorLayer._clipboardManager.paste();
    if (!editor) {
      return;
    }
    const cmd = () => {
      this.#addOrRebuild(editor);
    };
    const undo = () => {
      editor.remove();
    };

    this.addCommands(cmd, undo);
  }

  /**
   * Select all the editors.
   */
  selectAll() {
    AnnotationEditorLayer._isAllSelected = true;
    for (const editor of AnnotationEditorLayer._allEditors.values()) {
      editor.div.classList.add("selectedEditor");
    }
  }

  /**
   * Unselect all the editors.
   */
  unselectAll() {
    AnnotationEditorLayer._isAllSelected = false;
    for (const editor of AnnotationEditorLayer._allEditors.values()) {
      editor.div.classList.remove("selectedEditor");
    }
  }

  /**
   * Enable pointer events on the main div in order to enable
   * editor creation.
   */
  enable() {
    this.div.style.pointerEvents = "auto";
  }

  /**
   * Disable editor creation.
   */
  disable() {
    this.div.style.pointerEvents = "none";
  }

  /**
   * Set the current editor.
   * @param {AnnotationEditor} editor
   */
  setActiveEditor(editor) {
    if (editor) {
      this.unselectAll();
      this.div.removeEventListener("click", this.#boundClick);
    } else {
      AnnotationEditorLayer._allowClick = false;
      this.div.addEventListener("click", this.#boundClick);
    }
    AnnotationEditorLayer._activeEditor = editor;
  }

  /**
   * Remove an editor.
   * @param {AnnotationEditor} editor
   */
  remove(editor) {
    // Since we can undo a removal we need to keep the
    // parent property as it is, so don't null it!

    AnnotationEditorLayer._allEditors.delete(editor.id);
    this._editors.delete(editor.id);
    this.annotationStorage.removeKey(editor.id);
    editor.div.remove();
    editor.isAttachedToDOM = false;
    if (AnnotationEditorLayer._activeEditor === editor) {
      this.setActiveEditor(null);
      AnnotationEditorLayer._allowClick = true;
      this.div.focus();
    }
  }

  /**
   * An editor can have a different parent, for example after having
   * being dragged and droped from a page to another.
   * @param {AnnotationEditor} editor
   * @returns {undefined}
   */
  #changeParent(editor) {
    if (editor.parent === this) {
      return;
    }
    this._editors.set(editor.id, editor);
    editor.pageIndex = this.pageIndex;
    editor.parent?._editors.delete(editor.id);
    editor.parent = this;
    if (editor.div && editor.isAttachedToDOM) {
      editor.div.remove();
      this.div.appendChild(editor.div);
    }
  }

  /**
   * Add a new editor in the current view.
   * @param {AnnotationEditor} editor
   */
  add(editor) {
    this.#changeParent(editor);
    this.annotationStorage.setValue(editor.id, editor);
    AnnotationEditorLayer._allEditors.set(editor.id, editor);
    this._editors.set(editor.id, editor);

    if (!editor.isAttachedToDOM) {
      const div = editor.render();
      this.div.appendChild(div);
      editor.isAttachedToDOM = true;
    }

    editor.onceAdded();
  }

  /**
   * Add or rebuild depending if it has been removed or not.
   * @param {AnnotationEditor} editor
   */
  #addOrRebuild(editor) {
    if (editor.needsToBeRebuilt()) {
      editor.rebuild();
    } else {
      this.add(editor);
    }
  }

  /**
   * Add a new editor and make this addition undoable.
   * @param {AnnotationEditor} editor
   */
  addANewEditor(editor) {
    const cmd = () => {
      this.#addOrRebuild(editor);
    };
    const undo = () => {
      editor.remove();
    };

    this.addCommands(cmd, undo);
  }

  /**
   * Get an id for an editor.
   * @returns {string}
   */
  getNextId() {
    return AnnotationEditorLayer._idManager.getId();
  }

  /**
   * Mouseclick callback.
   * @param {MouseEvent} event
   * @returns {undefined}
   */
  click(event) {
    if (!AnnotationEditorLayer._allowClick) {
      AnnotationEditorLayer._allowClick = true;
      return;
    }

    if (!AnnotationEditorLayer._currentEditorClass) {
      return;
    }

    const id = this.getNextId();
    const editor = new AnnotationEditorLayer._currentEditorClass({
      parent: this,
      id,
      x: event.offsetX,
      y: event.offsetY,
    });
    this.addANewEditor(editor);
  }

  /**
   * Drag callback.
   * @param {DragEvent} event
   * @returns {undefined}
   */
  drop(event) {
    const id = event.dataTransfer.getData("text/plain");
    const editor = AnnotationEditorLayer._allEditors.get(id);
    if (!editor) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    this.#changeParent(editor);

    const rect = this.div.getBoundingClientRect();
    editor.setAt(
      event.clientX - rect.x - editor.mouseX,
      event.clientY - rect.y - editor.mouseY
    );
  }

  /**
   * Dragover callback.
   * @param {DragEvent} event
   */
  dragover(event) {
    event.preventDefault();
  }

  /**
   * Keydown callback.
   * @param {KeyEvent} event
   */
  keydown(event) {
    if (!AnnotationEditorLayer._activeEditor?.shouldGetKeyboardEvents()) {
      AnnotationEditorLayer._keyboardManager.exec(this, event);
    }
  }

  /**
   * Destroy the main editor.
   */
  destroy() {
    for (const editor of this._editors.values()) {
      editor.isAttachedToDOM = false;
      editor.div.remove();
      editor.parent = null;
      this.div = null;
    }
    this._editors.clear();
  }

  /**
   * Render the main editor.
   * @param {Object} parameters
   */
  render(parameters) {
    this.viewport = parameters.viewport;
    bindEvents(this, this.div, ["dragover", "drop", "keydown"]);
    this.div.addEventListener("click", this.#boundClick);
  }

  /**
   * Update the main editor.
   * @param {Object} parameters
   */
  update(parameters) {
    const transform = Util.transform(
      parameters.viewport.transform,
      this.viewport.inverseTransform
    );
    this.viewport = parameters.viewport;
    for (const editor of this._editors.values()) {
      editor.transform(transform);
    }
  }

  /**
   * Get the scale factor from the viewport.
   * @returns {number}
   */
  get scaleFactor() {
    return this.viewport.scale;
  }

  /**
   * Get the zoom factor.
   * @returns {number}
   */
  get zoomFactor() {
    return this.viewport.scale / PixelsPerInch.PDF_TO_CSS_UNITS;
  }
}

export { AnnotationEditorLayer };
