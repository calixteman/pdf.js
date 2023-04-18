/* Copyright 2015 Mozilla Foundation
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

/** @typedef {import("./display_utils").PageViewport} PageViewport */
/** @typedef {import("./api").TextContent} TextContent */

import {
  AbortException,
  FeatureTest,
  PromiseCapability,
  Util,
} from "../shared/util.js";
import { deprecated, setLayerDimensions } from "./display_utils.js";

/**
 * Text layer render parameters.
 *
 * @typedef {Object} TextLayerRenderParameters
 * @property {ReadableStream | TextContent} textContentSource - Text content to
 *   render, i.e. the value returned by the page's `streamTextContent` or
 *   `getTextContent` method.
 * @property {HTMLElement} container - The DOM node that will contain the text
 *   runs.
 * @property {PageViewport} viewport - The target viewport to properly layout
 *   the text runs.
 * @property {Array<HTMLElement>} [textDivs] - HTML elements that correspond to
 *   the text items of the textContent input.
 *   This is output and shall initially be set to an empty array.
 * @property {WeakMap<HTMLElement,Object>} [textDivProperties] - Some properties
 *   weakly mapped to the HTML elements used to render the text.
 * @property {Array<string>} [textContentItemsStr] - Strings that correspond to
 *   the `str` property of the text items of the textContent input.
 *   This is output and shall initially be set to an empty array.
 * @property {boolean} [isOffscreenCanvasSupported] true if we can use
 *   OffscreenCanvas to measure string widths.
 */

/**
 * Text layer update parameters.
 *
 * @typedef {Object} TextLayerUpdateParameters
 * @property {HTMLElement} container - The DOM node that will contain the text
 *   runs.
 * @property {PageViewport} viewport - The target viewport to properly layout
 *   the text runs.
 * @property {Array<HTMLElement>} [textDivs] - HTML elements that correspond to
 *   the text items of the textContent input.
 *   This is output and shall initially be set to an empty array.
 * @property {WeakMap<HTMLElement,Object>} [textDivProperties] - Some properties
 *   weakly mapped to the HTML elements used to render the text.
 * @property {boolean} [isOffscreenCanvasSupported] true if we can use
 *   OffscreenCanvas to measure string widths.
 * @property {boolean} [mustRotate] true if the text layer must be rotated.
 * @property {boolean} [mustRescale] true if the text layer contents must be
 *   rescaled.
 */

const MAX_TEXT_DIVS_TO_RENDER = 100000;
const DEFAULT_FONT_SIZE = 30;
const DEFAULT_FONT_ASCENT = 0.8;
const ascentCache = new Map();

function getCtx(size, isOffscreenCanvasSupported) {
  let ctx;
  if (isOffscreenCanvasSupported && FeatureTest.isOffscreenCanvasSupported) {
    ctx = new OffscreenCanvas(size, size).getContext("2d", { alpha: false });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    ctx = canvas.getContext("2d", { alpha: false });
  }
  ctx.fontKerning = "none";

  return ctx;
}

function getAscent(fontFamily, isOffscreenCanvasSupported) {
  const cachedAscent = ascentCache.get(fontFamily);
  if (cachedAscent) {
    return cachedAscent;
  }

  const ctx = getCtx(DEFAULT_FONT_SIZE, isOffscreenCanvasSupported);

  ctx.font = `${DEFAULT_FONT_SIZE}px ${fontFamily}`;
  const metrics = ctx.measureText("");

  // Both properties aren't available by default in Firefox.
  let ascent = metrics.fontBoundingBoxAscent;
  let descent = Math.abs(metrics.fontBoundingBoxDescent);
  if (ascent) {
    const ratio = ascent / (ascent + descent);
    ascentCache.set(fontFamily, ratio);

    ctx.canvas.width = ctx.canvas.height = 0;
    return ratio;
  }

  // Try basic heuristic to guess ascent/descent.
  // Draw a g with baseline at 0,0 and then get the line
  // number where a pixel has non-null red component (starting
  // from bottom).
  ctx.strokeStyle = "red";
  ctx.clearRect(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE);
  ctx.strokeText("g", 0, 0);
  let pixels = ctx.getImageData(
    0,
    0,
    DEFAULT_FONT_SIZE,
    DEFAULT_FONT_SIZE
  ).data;
  descent = 0;
  for (let i = pixels.length - 1 - 3; i >= 0; i -= 4) {
    if (pixels[i] > 0) {
      descent = Math.ceil(i / 4 / DEFAULT_FONT_SIZE);
      break;
    }
  }

  // Draw an A with baseline at 0,DEFAULT_FONT_SIZE and then get the line
  // number where a pixel has non-null red component (starting
  // from top).
  ctx.clearRect(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE);
  ctx.strokeText("A", 0, DEFAULT_FONT_SIZE);
  pixels = ctx.getImageData(0, 0, DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE).data;
  ascent = 0;
  for (let i = 0, ii = pixels.length; i < ii; i += 4) {
    if (pixels[i] > 0) {
      ascent = DEFAULT_FONT_SIZE - Math.floor(i / 4 / DEFAULT_FONT_SIZE);
      break;
    }
  }

  ctx.canvas.width = ctx.canvas.height = 0;

  if (ascent) {
    const ratio = ascent / (ascent + descent);
    ascentCache.set(fontFamily, ratio);
    return ratio;
  }

  ascentCache.set(fontFamily, DEFAULT_FONT_ASCENT);
  return DEFAULT_FONT_ASCENT;
}

function appendText(task, geom, styles) {
  // Initialize all used properties to keep the caches monomorphic.
  const textDiv = document.createElement("span");
  const tx = Util.transform(task._transform, geom.transform);
  const {
    scaleX,
    scaleY: fontSize,
    transform,
  } = Util.getGeometricProperties(geom.transform);
  const style = styles[geom.fontName];

  const textDivProperties = {
    angle: 0,
    hasText: geom.str !== "",
    hasEOL: geom.hasEOL,
    isFontForHtml: geom.isFontForHtml,
    fontSize,
    averageSpaceWidth: geom.averageSpaceWidth || NaN,
    averageTrackingWidth: geom.averageTrackingWidth || 0,
    transform,
    scaleX,
    width: geom.width,
    height: geom.height,
    top: tx[5],
    left: tx[4],
    fontAscent: style.ascent,
    fontDescent: style.descent,
    textContent: geom.str,
  };
  task._textDivs.push(textDiv);

  if (style.vertical) {
    textDivProperties.angle = Math.PI / 2;
    textDivProperties.width = geom.height;
    textDivProperties.height = geom.width;
  }

  const divStyle = textDiv.style;

  divStyle.fontFamily = geom.isFontForHtml
    ? `${geom.fontName}, "Liberation Sans"`//${style.fontFamily}`
    : style.fontFamily;

  // Keeps screen readers from pausing on every new text span.
  textDiv.setAttribute("role", "presentation");

  textDiv.textContent = geom.str;
  // geom.dir may be 'ttb' for vertical texts.
  textDiv.dir = geom.dir;

  // `fontName` is only used by the FontInspector, and we only use `dataset`
  // here to make the font name available in the debugger.
  if (task._fontInspectorEnabled) {
    textDiv.dataset.fontName = geom.fontName;
  }

  task._textDivProperties.set(textDiv, textDivProperties);
  if (task._isReadableStream) {
    task._layoutText(textDiv);
  }
}

function numberToString(value, precision) {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(precision);
}

function layout(params) {
  const {
    div,
    properties,
    ctx,
    prevFontSize,
    prevFontFamily,
    isRootContainer,
  } = params;
  const {
    width,
    hasText,
    height,
    isFontForHtml,
    fontSize: baseFontSize,
    fontAscent,
    fontDescent,
    transform: boxTransform,
    scaleX,
    textContent,
  } = properties;
  let { averageTrackingWidth, averageSpaceWidth, angle } = properties;

  if (!hasText) {
    return;
  }

  const { style } = div;
  const calcStr = "calc(var(--scale-factor)*";
  const varStr = "var(--scale-factor)";
  const { fontFamily } = style;
  const { left, top } = properties;
  let ascent, descent, metrics;
  const scale = isFontForHtml ? 1 : params.scale;
  const fontSize = baseFontSize * scale;

  if (prevFontSize !== fontSize || prevFontFamily !== fontFamily) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    params.prevFontSize = fontSize;
    params.prevFontFamily = fontFamily;
    params.whiteSpaceWidth = NaN;
  }

  ctx.letterSpacing = ctx.wordSpacing = "0px";
  //ctx.textRendering = "geometricPrecision";

  if (!isFontForHtml || (fontAscent === 0 && fontDescent === 0)) {
    // We can't cache the following values because they depend on textContent.
    metrics = ctx.measureText(textContent);
    ({ fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } =
      metrics);
    if (ascent === undefined) {
      if (isFontForHtml) {
        ({
          actualBoundingBoxAscent: ascent,
          actualBoundingBoxDescent: descent,
        } = metrics);
      } else {
        ascent = Math.ceil(0.8 * fontSize);
        descent = Math.ceil(0.2 * fontSize);
      }
    }
  } else {
    ascent = Math.floor(Math.abs(fontAscent) * baseFontSize);
    descent = Math.floor(Math.abs(fontDescent) * baseFontSize);
  }

  const h = (ascent + descent) / scale;
  const extra = (height - h) / 2;
  const shift = ascent / scale + extra;

  if (isRootContainer) {
    style.top = `${numberToString(
      Math.floor(100 * top) / params.pageHeight,
      3
    )}%`;
    style.left = `${numberToString(
      Math.floor(100 * left) / params.pageWidth,
      3
    )}%`;
  } else {
    // We're in a marked content span, hence we can't use percents.
    style.top = `${calcStr}${numberToString(top, 3)}px)`;
    style.left = `${calcStr}${numberToString(left, 3)}px)`;
  }

  const transform = [];

  if (angle && boxTransform) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const [a, b, c, d] = boxTransform;
    boxTransform[0] = a * cos - b * sin;
    boxTransform[1] = a * sin + b * cos;
    boxTransform[2] = c * cos - d * sin;
    boxTransform[3] = c * sin + d * cos;
    angle = 0;
  }

  if (angle) {
    transform.push(`rotate(${(180 * angle) / Math.PI}deg)`);
  }
  if (boxTransform) {
    transform.push(`matrix(${boxTransform.join(",")},0,0)`);
  }
  transform.push(`translateY(${calcStr}${-shift}px))`);

  if (!isFontForHtml) {
    const { width: contentWidth } = metrics;
    if (width > 0 && contentWidth > 0 && textContent !== " ") {
      transform.push(
        `scale(${calcStr}${numberToString(
          (width * scale) / (contentWidth * scaleX),
          3
        )}),${varStr})`
      );
    } else {
      transform.push(`scale(${varStr})`);
    }

    style.transform = transform.join(" ");
    style.fontSize = `${baseFontSize}px`;

    return;
  }

  // These two values have computed in taking into account the current transform
  // so we must rescale them in order to have corret values when compared to the
  // metrics values obtained with the ctx.measureText method.
  averageSpaceWidth /= scaleX;
  averageTrackingWidth /= scaleX;
  //averageSpaceWidth += 0.5
  
  if (!isNaN(averageSpaceWidth) && isNaN(params.whiteSpaceWidth)) {
    // We must calculate the width of the white space character before setting
    // the letter-spacing property to avoid an incorrect value to be cached.
    params.whiteSpaceWidth = ctx.measureText(" ").width;
    //console.log(ctx.measureText("a a").width, ctx.measureText(" ").width, 2 * ctx.measureText("a").width)
  }

  if (textContent.length > 1 && Math.abs(averageTrackingWidth) >= 1e-3) {
    style.letterSpacing = `${calcStr}${averageTrackingWidth}px)`;
    ctx.letterSpacing = `${averageTrackingWidth}px`;
  }

  if (!isNaN(averageSpaceWidth)) {
    const wordSpacing =
      averageSpaceWidth - params.whiteSpaceWidth - 2 * averageTrackingWidth;
    console.log(textContent, baseFontSize, wordSpacing, averageSpaceWidth, params.whiteSpaceWidth, averageTrackingWidth)

    if (Math.abs(wordSpacing) >= 1e-3) {
      style.wordSpacing = `${calcStr}${wordSpacing}px)`;
      ctx.wordSpacing = `${wordSpacing}px`;
    }
  }

  //metrics = ctx.measureText(textContent);
  if (false &&textContent !== " " && Math.abs(metrics.width * scaleX - width) > 2) {
    const w1 = ctx.measureText("A").width;
    const w2 = ctx.measureText(`AAA${textContent}AAA`).width;
    style.border = "10px solid red";
    console.error(
      "___" + textContent + "___",
      metrics.width * scaleX,
      width,
      ctx.font,
      w2 - 6 * w1
    );
    // throw new Error(`WTF: textContent=${textContent}, textWidth=${metrics.width * scaleX}, width=${width}, diff=${Math.abs(metrics.width * scaleX - width)}`)
  }

  style.transform = transform.join(" ");
  style.fontSize = `${calcStr}${baseFontSize}px)`;
}

function render(task) {
  if (task._canceled) {
    return;
  }
  const textDivs = task._textDivs;
  const capability = task._capability;
  const textDivsLength = textDivs.length;

  // No point in rendering many divs as it would make the browser
  // unusable even after the divs are rendered.
  if (textDivsLength > MAX_TEXT_DIVS_TO_RENDER) {
    capability.resolve();
    return;
  }

  if (!task._isReadableStream) {
    for (const textDiv of textDivs) {
      task._layoutText(textDiv);
    }
  }
  capability.resolve();
}

class TextLayerRenderTask {
  constructor({
    textContentSource,
    container,
    viewport,
    textDivs,
    textDivProperties,
    textContentItemsStr,
    isOffscreenCanvasSupported,
  }) {
    this._textContentSource = textContentSource;
    this._isReadableStream = textContentSource instanceof ReadableStream;
    this._container = this._rootContainer = container;
    this._textDivs = textDivs || [];
    this._textContentItemsStr = textContentItemsStr || [];
    this._isOffscreenCanvasSupported = isOffscreenCanvasSupported;
    this._fontInspectorEnabled = !!globalThis.FontInspector?.enabled;

    this._reader = null;
    this._textDivProperties = textDivProperties || new WeakMap();
    this._canceled = false;
    this._capability = new PromiseCapability();
    const { pageWidth, pageHeight, pageX, pageY } = viewport.rawDims;
    this._transform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
    this._pageWidth = pageWidth;
    this._pageHeight = pageHeight;

    this._layoutTextParams = {
      prevFontSize: null,
      prevFontFamily: null,
      div: null,
      scale: globalThis.devicePixelRatio || 1,
      properties: null,
      ctx: getCtx(0, isOffscreenCanvasSupported),
      pageHeight,
      pageWidth,
    };

    setLayerDimensions(container, viewport);

    // Always clean-up the temporary canvas once rendering is no longer pending.
    this._capability.promise
      .finally(() => {
        const canvas = this._layoutTextParams.ctx.canvas;
        canvas.width = canvas.height = 0;
        this._layoutTextParams = null;
        this._textDivProperties = null;
      })
      .catch(() => {
        // Avoid "Uncaught promise" messages in the console.
      });
  }

  /**
   * Promise for textLayer rendering task completion.
   * @type {Promise<void>}
   */
  get promise() {
    return this._capability.promise;
  }

  /**
   * Cancel rendering of the textLayer.
   */
  cancel() {
    this._canceled = true;
    if (this._reader) {
      this._reader
        .cancel(new AbortException("TextLayer task cancelled."))
        .catch(() => {
          // Avoid "Uncaught promise" messages in the console.
        });
      this._reader = null;
    }
    this._capability.reject(new AbortException("TextLayer task cancelled."));
  }

  /**
   * @private
   */
  _processItems(items, styleCache) {
    for (const item of items) {
      if (item.str === undefined) {
        if (
          item.type === "beginMarkedContentProps" ||
          item.type === "beginMarkedContent"
        ) {
          const parent = this._container;
          this._container = document.createElement("span");
          this._container.classList.add("markedContent");
          if (item.id !== null) {
            this._container.setAttribute("id", `${item.id}`);
          }
          parent.append(this._container);
        } else if (item.type === "endMarkedContent") {
          this._container = this._container.parentNode;
        }
        continue;
      }
      this._textContentItemsStr.push(item.str);
      appendText(this, item, styleCache);
    }
  }

  /**
   * @private
   */
  _layoutText(textDiv) {
    const textDivProperties = (this._layoutTextParams.properties =
      this._textDivProperties.get(textDiv));
    this._layoutTextParams.div = textDiv;
    this._layoutTextParams.isRootContainer =
      this._container === this._rootContainer;
    layout(this._layoutTextParams);

    if (textDivProperties.hasText) {
      this._container.append(textDiv);
    }
    if (textDivProperties.hasEOL) {
      const br = document.createElement("br");
      br.setAttribute("role", "presentation");
      this._container.append(br);
    }
  }

  /**
   * @private
   */
  _render() {
    const capability = new PromiseCapability();
    let styleCache = Object.create(null);

    if (this._isReadableStream) {
      const pump = () => {
        this._reader.read().then(({ value, done }) => {
          if (done) {
            capability.resolve();
            return;
          }

          Object.assign(styleCache, value.styles);
          this._processItems(value.items, styleCache);
          pump();
        }, capability.reject);
      };

      this._reader = this._textContentSource.getReader();
      pump();
    } else if (this._textContentSource) {
      const { items, styles } = this._textContentSource;
      this._processItems(items, styles);
      capability.resolve();
    } else {
      throw new Error('No "textContentSource" parameter specified.');
    }

    capability.promise.then(() => {
      styleCache = null;
      render(this);
    }, this._capability.reject);
  }
}

/**
 * @param {TextLayerRenderParameters} params
 * @returns {TextLayerRenderTask}
 */
function renderTextLayer(params) {
  if (
    (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) &&
    !params.textContentSource &&
    (params.textContent || params.textContentStream)
  ) {
    deprecated(
      "The TextLayerRender `textContent`/`textContentStream` parameters " +
        "will be removed in the future, please use `textContentSource` instead."
    );
    params.textContentSource = params.textContent || params.textContentStream;
  }
  if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("GENERIC && !TESTING")) {
    const { container, viewport } = params;
    const style = getComputedStyle(container);
    const visibility = style.getPropertyValue("visibility");
    const scaleFactor = parseFloat(style.getPropertyValue("--scale-factor"));

    if (
      visibility === "visible" &&
      (!scaleFactor || Math.abs(scaleFactor - viewport.scale) > 1e-5)
    ) {
      console.error(
        "The `--scale-factor` CSS-variable must be set, " +
          "to the same value as `viewport.scale`, " +
          "either on the `container`-element itself or higher up in the DOM."
      );
    }
  }
  const task = new TextLayerRenderTask(params);
  task._render();
  return task;
}

/**
 * @param {TextLayerUpdateParameters} params
 * @returns {undefined}
 */
function updateTextLayer({ container, viewport, mustRotate = true }) {
  if (mustRotate) {
    setLayerDimensions(container, { rotation: viewport.rotation });
  }
}

export { renderTextLayer, TextLayerRenderTask, updateTextLayer };
