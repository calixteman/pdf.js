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

import { AbortException, isNodeJS } from "../../src/shared/util.js";
import {
  buildGetDocumentParams,
  buildTextPdf,
  buildVerticalTextPdf,
  CMAP_URL,
} from "./test_utils.js";
import { DEFAULT_FONT_SIZE, TextLayer } from "../../src/display/text_layer.js";
import { getDocument } from "../../src/display/api.js";
import { OutputScale } from "../../src/display/output_scale.js";

describe("textLayer", function () {
  function createStyledContainer() {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "../../web/text_layer_builder.css";
    const stylesheetLoaded = Promise.withResolvers();
    stylesheet.onload = stylesheetLoaded.resolve;
    stylesheet.onerror = stylesheetLoaded.reject;
    document.head.append(stylesheet);
    const container = document.createElement("div");
    container.className = "textLayer";
    container.style.setProperty("--total-scale-factor", "1");
    container.style.setProperty("--scale-round-x", "1px");
    container.style.setProperty("--scale-round-y", "1px");
    document.body.append(container);
    return { stylesheet, stylesheetLoaded, container };
  }

  it("creates textLayer from ReadableStream", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const loadingTask = getDocument(buildGetDocumentParams("basicapi.pdf"));
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);

    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: document.createElement("div"),
      viewport: page.getViewport({ scale: 1 }),
    });
    await textLayer.render();

    expect(textLayer.textContentItemsStr).toEqual([
      "Table Of Content",
      "",
      "Chapter 1",
      " ",
      "..........................................................",
      " ",
      "2",
      "",
      "Paragraph 1.1",
      " ",
      "......................................................",
      " ",
      "3",
      "",
      "page 1 / 3",
    ]);

    await loadingTask.destroy();
  });

  it("creates textLayer from TextContent", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const loadingTask = getDocument(buildGetDocumentParams("basicapi.pdf"));
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);

    const textLayer = new TextLayer({
      textContentSource: await page.getTextContent(),
      container: document.createElement("div"),
      viewport: page.getViewport({ scale: 1 }),
    });
    await textLayer.render();

    expect(textLayer.textContentItemsStr).toEqual([
      "Table Of Content",
      "",
      "Chapter 1",
      " ",
      "..........................................................",
      " ",
      "2",
      "",
      "Paragraph 1.1",
      " ",
      "......................................................",
      " ",
      "3",
      "",
      "page 1 / 3",
    ]);

    await loadingTask.destroy();
  });

  it("creates textLayers in parallel, from ReadableStream", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    if (typeof ReadableStream.from !== "function") {
      pending("ReadableStream.from is not supported.");
    }
    const getTransform = container => {
      const transform = [];

      for (const { style } of container.childNodes) {
        transform.push({
          fontHeight: style.fontSize,
          transform: style.transform,
        });
      }
      return transform;
    };

    const loadingTask = getDocument(buildGetDocumentParams("basicapi.pdf"));
    const pdfDocument = await loadingTask.promise;
    const [page1, page2] = await Promise.all([
      pdfDocument.getPage(1),
      pdfDocument.getPage(2),
    ]);

    // Create text-content streams with dummy content.
    const items1 = [
      {
        str: "Chapter A",
        dir: "ltr",
        width: 100,
        height: 20,
        transform: [20, 0, 0, 20, 45, 744],
        fontName: "g_d0_f1",
        hasEOL: false,
      },
      {
        str: "page 1",
        dir: "ltr",
        width: 50,
        height: 20,
        transform: [20, 0, 0, 20, 45, 744],
        fontName: "g_d0_f1",
        hasEOL: false,
      },
    ];
    const items2 = [
      {
        str: "Chapter B",
        dir: "ltr",
        width: 120,
        height: 10,
        transform: [10, 0, 0, 10, 492, 16],
        fontName: "g_d0_f2",
        hasEOL: false,
      },
      {
        str: "page 2",
        dir: "ltr",
        width: 60,
        height: 10,
        transform: [10, 0, 0, 10, 492, 16],
        fontName: "g_d0_f2",
        hasEOL: false,
      },
    ];

    const styles = {
      g_d0_f1: {
        ascent: 0.75,
        descent: -0.25,
        fontFamily: "serif",
        vertical: false,
      },
      g_d0_f2: {
        ascent: 0.5,
        descent: -0.5,
        fontFamily: "sans-serif",
        vertical: false,
      },
    };
    const lang = "en";

    // Render the textLayers serially, to have something to compare against.
    const serialContainer1 = document.createElement("div"),
      serialContainer2 = document.createElement("div");

    const serialTextLayer1 = new TextLayer({
      textContentSource: { items: items1, styles, lang },
      container: serialContainer1,
      viewport: page1.getViewport({ scale: 1 }),
    });
    await serialTextLayer1.render();

    const serialTextLayer2 = new TextLayer({
      textContentSource: { items: items2, styles, lang },
      container: serialContainer2,
      viewport: page2.getViewport({ scale: 1 }),
    });
    await serialTextLayer2.render();

    const serialTransform1 = getTransform(serialContainer1),
      serialTransform2 = getTransform(serialContainer2);

    expect(serialTransform1.length).toEqual(2);
    expect(serialTransform2.length).toEqual(2);

    // Reset any global textLayer-state before rendering in parallel.
    TextLayer.cleanup();

    const container1 = document.createElement("div"),
      container2 = document.createElement("div");
    const waitCapability1 = Promise.withResolvers();

    const streamGenerator1 = (async function* () {
      for (const item of items1) {
        yield { items: [item], styles, lang };
        await waitCapability1.promise;
      }
    })();
    const streamGenerator2 = (async function* () {
      for (const item of items2) {
        yield { items: [item], styles, lang };
      }
    })();

    const textLayer1 = new TextLayer({
      textContentSource: ReadableStream.from(streamGenerator1),
      container: container1,
      viewport: page1.getViewport({ scale: 1 }),
    });
    const textLayer1Promise = textLayer1.render();

    const textLayer2 = new TextLayer({
      textContentSource: ReadableStream.from(streamGenerator2),
      container: container2,
      viewport: page2.getViewport({ scale: 1 }),
    });
    await textLayer2.render();

    // Ensure that the first textLayer has its rendering "paused" while
    // the second textLayer renders.
    waitCapability1.resolve();
    await textLayer1Promise;

    // Sanity check to make sure that all text was parsed.
    expect(textLayer1.textContentItemsStr).toEqual(["Chapter A", "page 1"]);
    expect(textLayer2.textContentItemsStr).toEqual(["Chapter B", "page 2"]);

    // Ensure that the transforms are identical when parsing in series/parallel.
    const transform1 = getTransform(container1),
      transform2 = getTransform(container2);

    expect(transform1).toEqual(serialTransform1);
    expect(transform2).toEqual(serialTransform2);

    await loadingTask.destroy();
  });

  describe("with text layer fonts", function () {
    let loadingTask, textContent, viewport, textLayers;

    const hasFont = (name, ownerDocument = document) =>
      [...ownerDocument.fonts].some(
        ({ family }) => family.replaceAll('"', "") === name
      );

    function createTextLayer(container = document.createElement("div")) {
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });
      textLayers.push(textLayer);
      return textLayer;
    }

    beforeEach(async function () {
      if (isNodeJS) {
        pending("document.createElement is not supported in Node.js.");
      }
      textLayers = [];
      loadingTask = getDocument(buildGetDocumentParams("tracemonkey.pdf"));
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(1);
      textContent = await page.getTextContent({
        disableNormalization: true,
        includeTextLayerFonts: true,
      });
      viewport = page.getViewport({ scale: 1 });
    });

    afterEach(async function () {
      for (const textLayer of textLayers || []) {
        textLayer.cancel();
      }
      await loadingTask?.destroy();
    });

    it("only scales width-fitted spans when the endpoint moves appreciably", async function () {
      const item = textContent.items.find(({ str }) => str);
      const widths = [10.005, 1000.05];
      textContent = {
        ...textContent,
        items: widths.map((width, i) => ({
          ...item,
          str: i ? "A".repeat(100) : "A",
          transform: [20, 0, 0, 20, 10, 100],
          width,
          letterSpacing: undefined,
          textLayerAdvance: i ? 50 : 0.5,
        })),
      };
      const layer = createTextLayer();
      await layer.render();
      const [short, long] = layer.textDivs;
      expect(short.style.transform).toBe("");
      expect(new DOMMatrix(long.style.transform).a).toBeCloseTo(
        widths[1] / 1000,
        6
      );
    });

    it("fits isolated glyphs with the same text and different PDF widths", async function () {
      const item = textContent.items.find(({ str }) => /^[A-Z]/i.test(str));
      const widths = [3, 12];
      textContent.items = widths.map(width => ({
        ...item,
        str: item.str[0],
        width,
        letterSpacing: undefined,
        textLayerAdvance: undefined,
      }));
      const { container, stylesheet, stylesheetLoaded } =
        createStyledContainer();
      try {
        await stylesheetLoaded;
        const layer = createTextLayer(container);
        await layer.render();
        for (const [i, span] of layer.textDivs.entries()) {
          expect(span.getBoundingClientRect().width).toBeCloseTo(widths[i], 1);
        }
      } finally {
        container.remove();
        stylesheet.remove();
      }
    });

    it("lays out the text and shares the fonts until the last cancellation", async function () {
      const first = createTextLayer();
      const second = createTextLayer();
      await Promise.all(textLayers.map(textLayer => textLayer.render()));

      const { pageHeight, pageY } = viewport.rawDims;
      const { items, styles } = textContent;
      const names = new Set();
      expect(first.textDivs.length).toEqual(items.length);
      for (const [i, { style }] of first.textDivs.entries()) {
        const { name, ascent } = styles[items[i].fontName].textLayerFont;
        names.add(name);
        expect(style.fontFamily.replaceAll('"', "")).toBe(name);
        // The span is moved up by the ascent of the font.
        const [, , , d, , f] = items[i].transform;
        expect(parseFloat(style.top)).toBeCloseTo(
          (100 * (pageY + pageHeight - f - ascent * d)) / pageHeight,
          2
        );
      }
      expect([...names].every(name => hasFont(name))).toBeTrue();
      const spaces = first.textDivs.filter(
        ({ textContent: str }) => str === " "
      );
      expect(spaces.length).toBeGreaterThan(0);
      expect(spaces.every(({ style }) => style.transform === "")).toBeTrue();

      first.cancel();
      expect([...names].every(name => hasFont(name))).toBeTrue();
      second.cancel();
      expect([...names].some(name => hasFont(name))).toBeFalse();
    });

    it("loads and measures fonts in the container's document", async function () {
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      const { contentDocument } = iframe;
      const inner = createTextLayer(contentDocument.createElement("div"));
      const outer = createTextLayer();
      const { name } =
        textContent.styles[textContent.items[0].fontName].textLayerFont;

      try {
        await inner.render();
        expect(hasFont(name, contentDocument)).toBeTrue();
        expect(hasFont(name)).toBeFalse();

        await outer.render();
        expect(hasFont(name)).toBeTrue();
        const getTransforms = ({ textDivs }) =>
          textDivs.map(({ style }) => style.transform);
        expect(getTransforms(inner)).toEqual(getTransforms(outer));

        inner.cancel();
        expect(hasFont(name, contentDocument)).toBeFalse();
        expect(hasFont(name)).toBeTrue();
      } finally {
        inner.cancel();
        TextLayer.cleanup();
        iframe.remove();
      }
    });

    it("doesn't load fonts when cancelled before rendering starts", async function () {
      const { name } =
        textContent.styles[textContent.items[0].fontName].textLayerFont;
      const textLayer = createTextLayer();
      const promise = textLayer.render();
      textLayer.cancel();
      await expectAsync(promise).toBeRejectedWith(jasmine.any(AbortException));
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
      expect(textLayer.textDivs).toEqual([]);
      expect(hasFont(name)).toBeFalse();
    });

    it("cancels rendering while the fonts are still loading", async function () {
      const loading = Promise.withResolvers();
      const started = Promise.withResolvers();
      spyOnProperty(FontFace.prototype, "loaded", "get").and.callFake(() => {
        started.resolve();
        return loading.promise;
      });

      const textLayer = createTextLayer();
      const promise = textLayer.render();
      try {
        await started.promise;
        textLayer.cancel();
        await expectAsync(promise).toBeRejectedWith(
          jasmine.any(AbortException)
        );
        expect(textLayer.textDivs).toEqual([]);
      } finally {
        loading.resolve();
      }
    });

    it("removes a failed font and renders with the fallback font", async function () {
      const { fontFamily, textLayerFont } =
        textContent.styles[textContent.items[0].fontName];
      textLayerFont.data = new Uint8Array(1);
      const textLayer = createTextLayer();
      await textLayer.render();

      expect(hasFont(textLayerFont.name)).toBeFalse();
      expect(textLayer.textDivs[0].style.fontFamily).toBe(
        TextLayer.fontFamilyMap.get(fontFamily) || fontFamily
      );
    });
  });

  it("positions glyphs with kerning, letter spacing and uneven word spacing", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const content =
      "BT /F1 20.00100012 Tf 10 150 Td 1 Tc 3 Tw [(A) 80 (VA) 80 (VA) 80 (V B)] TJ " +
      "0 -30 Td 0 Tc [(A) -300 (B) -300 (A) -500 (B)] TJ " +
      "0 -30 Td 80 Tz 0.001 Tc -0.001 Tw (AB CD) Tj ET";
    const loadingTask = getDocument({
      data: buildTextPdf(content),
    });
    const { stylesheet, stylesheetLoaded, container } = createStyledContainer();
    let textLayer;
    try {
      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(1);
      const textContent = await page.getTextContent({
        includeTextLayerFonts: true,
      });
      textLayer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport: page.getViewport({ scale: 1 }),
      });
      await stylesheetLoaded.promise;
      await textLayer.render();

      const { items } = textContent;
      expect(items[0].str).toBe("AVAVAV B");
      expect(items[0].letterSpacing * 20).toBeCloseTo(1, 2);
      expect(items[0].wordSpacing * 20).toBeCloseTo(3, 2);
      expect(items[0].hasEOL).toBeTrue();
      expect(items.length).toBe(3);
      expect(items[1].str).toBe("A B A B");
      expect(textLayer.textDivs[1].textContent).toBe("A B A\u2002B");
      expect(container.classList.contains("newTextLayer")).toBeTrue();
      const { style } = textLayer.textDivs[0];
      expect(style.fontSize).toBe("20.001px");
      expect(style.letterSpacing).toBe("1.001px");
      expect(style.wordSpacing).toBe("3.001px");
      const fittedStyle = getComputedStyle(textLayer.textDivs[0]);
      expect(fittedStyle.transform).toBe("none");
      expect(fittedStyle.fontKerning).toBe("normal");
      expect(fittedStyle.fontVariantLigatures).toBe("none");
      const { style: scaledStyle } = textLayer.textDivs.at(-1);
      expect(scaledStyle.letterSpacing).toBe("");
      expect(scaledStyle.wordSpacing).toBe("");
      const scaled = new DOMMatrix(scaledStyle.transform);
      expect(scaled.a).toBeCloseTo(0.8, 6);
      expect(scaled.d).toBeCloseTo(1, 6);

      const origin = container.getBoundingClientRect().left;
      const expectedX = [
        10, 22.74, 37.08, 49.82, 64.16, 76.9, 100.8, 10, 29.34, 48.68, 72.02,
        10, 20.673, 35.795, 47.348,
      ];
      const range = document.createRange();
      container.style.setProperty("--scale-round-y", "3px");
      for (const zoom of [1, 4 / 3, 2]) {
        container.style.setProperty("--total-scale-factor", zoom);
        const { width, height } = container.getBoundingClientRect();
        expect(width).toBeCloseTo(Math.floor(200 * zoom), 1);
        expect(height).toBeCloseTo(3 * Math.floor((200 * zoom) / 3), 1);
        let glyphIndex = 0;
        for (const span of textLayer.textDivs) {
          const node = span.firstChild;
          for (let i = 0; i < span.textContent.length; i++) {
            if (/\s/.test(span.textContent[i])) {
              continue;
            }
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const actual = range.getBoundingClientRect().left - origin;
            expect(
              Math.abs(actual / zoom - expectedX[glyphIndex++])
            ).toBeLessThan(1);
          }
        }
        expect(glyphIndex).toBe(expectedX.length);
      }
    } finally {
      textLayer?.cancel();
      container.remove();
      stylesheet.remove();
      await loadingTask.destroy();
    }
  });

  it("fits vertical text with the generated font", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const loadingTask = getDocument(
      buildGetDocumentParams("vertical.pdf", {
        cMapUrl: CMAP_URL,
        useWorkerFetch: false,
      })
    );
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);
    const textContent = await page.getTextContent({
      includeTextLayerFonts: true,
    });
    const viewport = page.getViewport({ scale: 1 });
    TextLayer.cleanup();
    const getContext = spyOn(
      HTMLCanvasElement.prototype,
      "getContext"
    ).and.callThrough();
    const measureText = spyOn(
      CanvasRenderingContext2D.prototype,
      "measureText"
    ).and.callThrough();
    const [item] = textContent.items;
    // A ten-unit column with a (5, -20) writing axis in PDF coordinates.
    const column = {
      ...item,
      transform: [10, 0, -5, 20, 40, 180],
      width: 10,
      height: 5 * Math.hypot(5, 20),
    };
    const fractionalSize = 9.2126;
    const longColumn = {
      ...item,
      str: "あ".repeat(25),
      transform: [fractionalSize, 0, 0, fractionalSize, 60, 180],
      width: fractionalSize,
      height: 25 * fractionalSize,
    };
    const { stylesheet, stylesheetLoaded, container } = createStyledContainer();
    const textLayer = new TextLayer({
      textContentSource: { ...textContent, items: [item, column, longColumn] },
      container,
      viewport,
    });
    try {
      await stylesheetLoaded.promise;
      await textLayer.render();
      const [upright, skewed, long] = textLayer.textDivs;
      const computed = getComputedStyle(upright);
      expect(computed.writingMode).toBe("vertical-rl");
      expect(computed.textOrientation).toBe("upright");
      const { left, top } = container.getBoundingClientRect();
      const { pageHeight, pageX, pageY } = viewport.rawDims;
      const range = document.createRange();
      for (let i = 0; i < item.str.length; i++) {
        range.setStart(upright.firstChild, i);
        range.setEnd(upright.firstChild, i + 1);
        const rect = range.getBoundingClientRect();
        const expectedTop =
          pageHeight + pageY - item.transform[5] + i * item.width;
        expect(Math.abs(rect.top - top - expectedTop)).toBeLessThan(1);
        expect(
          Math.abs(
            rect.left - left - (item.transform[4] - pageX - item.width / 2)
          )
        ).toBeLessThan(1);
        expect(Math.abs(rect.height - item.width)).toBeLessThan(1);
      }
      expect(upright.textContent).toBe("\u3042\u3044\u3046\u3048\u304a");
      const { style } = skewed;
      const matrix = new DOMMatrix(style.transform);
      const layoutSize = parseFloat(style.fontSize);
      expect(matrix.a * layoutSize).toBeCloseTo(10, 5);
      expect(matrix.b * layoutSize).toBeCloseTo(0, 5);
      expect(matrix.c * layoutSize).toBeCloseTo(5, 5);
      expect(matrix.d * layoutSize).toBeCloseTo(20, 5);

      // Fractional advances must survive both initial layout and CSS zoom.
      for (const zoom of [1, 4 / 3, 2, 3]) {
        container.style.setProperty("--total-scale-factor", zoom);
        const origin = long.getBoundingClientRect().top;
        for (let i = 0; i < longColumn.str.length; i++) {
          range.setStart(long.firstChild, i);
          range.setEnd(long.firstChild, i + 1);
          const offset = (range.getBoundingClientRect().top - origin) / zoom;
          expect(Math.abs(offset - i * fractionalSize)).toBeLessThan(0.25);
        }
      }
      expect(getContext).not.toHaveBeenCalled();
      expect(measureText).not.toHaveBeenCalled();

      // Without fitted spacing or a known advance, use the canvas.
      const fallback = new TextLayer({
        textContentSource: {
          ...textContent,
          items: [
            { ...item, letterSpacing: undefined, textLayerAdvance: undefined },
          ],
        },
        container: document.createElement("div"),
        viewport,
      });
      try {
        await fallback.render();
        expect(measureText).toHaveBeenCalledOnceWith(item.str);
      } finally {
        fallback.cancel();
      }
    } finally {
      textLayer.cancel();
      container.remove();
      stylesheet.remove();
      await loadingTask.destroy();
    }
  });

  it("uses the PDF vertical advances and kerning for selection", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    // An advance of 18 px, 1 px character spacing and a -3 px pair adjustment.
    const content =
      "BT /F1 20 Tf -1 Tc 40 180 Td [<3042> -150 <30443042> -150 <304430fcff11>] TJ ET";
    const loadingTask = getDocument({
      data: buildVerticalTextPdf(content),
      cMapUrl: CMAP_URL,
      useWorkerFetch: false,
    });
    const { stylesheet, stylesheetLoaded, container } = createStyledContainer();
    let textLayer;
    try {
      const page = await (await loadingTask.promise).getPage(1);
      const textContent = await page.getTextContent({
        disableNormalization: true,
        includeTextLayerFonts: true,
      });
      textLayer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport: page.getViewport({ scale: 1 }),
      });
      await stylesheetLoaded.promise;
      await textLayer.render();
      expect(textContent.items[0].letterSpacing).toBeCloseTo(0.05, 3);
      const [span] = textLayer.textDivs;
      expect(span.textContent).toBe("あいあいー１");
      expect(span.classList.contains("vertical")).toBeTrue();
      const origin = container.getBoundingClientRect().top;
      const range = document.createRange();
      for (const [i, top] of [20, 36, 55, 71, 90, 109].entries()) {
        range.setStart(span.firstChild, i);
        range.setEnd(span.firstChild, i + 1);
        expect(
          Math.abs(range.getBoundingClientRect().top - origin - top)
        ).toBeLessThan(1);
      }
    } finally {
      textLayer?.cancel();
      container.remove();
      stylesheet.remove();
      await loadingTask.destroy();
    }
  });

  it("measures the text with the correct font after computing the ascent", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const loadingTask = getDocument(buildGetDocumentParams("issue19176.pdf"));
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);

    // Proportional widths should produce the same horizontal scale.
    const items = [10, 11].map(fontSize => ({
      str: "Hello World",
      dir: "ltr",
      width: 5 * fontSize,
      height: fontSize,
      transform: [fontSize, 0, 0, fontSize, 50, 700],
      fontName: "g_d0_f1",
      hasEOL: false,
    }));
    const styles = {
      g_d0_f1: {
        ascent: 0.75,
        descent: -0.25,
        fontFamily: "sans-serif",
        vertical: false,
      },
    };

    // Force the ascent to be computed for this font.
    TextLayer.cleanup();

    // Use DPR 1 to avoid rounding the first measurement away from 30px.
    spyOnProperty(OutputScale, "pixelRatio", "get").and.returnValue(1);
    const setFont = spyOnProperty(
      CanvasRenderingContext2D.prototype,
      "font",
      "set"
    ).and.callThrough();
    // Ensure that 30px is still the font size used to compute the ascent.
    expect(DEFAULT_FONT_SIZE).toEqual(30);

    const textLayer = new TextLayer({
      textContentSource: { items, styles, lang: "en" },
      container: document.createElement("div"),
      // Measure the first run at the 30px size used to compute the ascent.
      viewport: page.getViewport({ scale: 3 / page.userUnit }),
    });
    await textLayer.render();

    const [scaleX1, scaleX2] = textLayer.textDivs.map(
      ({ style }) => new DOMMatrix(style.transform || undefined).a
    );
    expect(scaleX1 / scaleX2).toBeCloseTo(1, 1);
    expect(setFont).toHaveBeenCalledWith(jasmine.stringMatching(/^33px /));

    await loadingTask.destroy();
  });

  it("positions the text precisely", async function () {
    if (isNodeJS) {
      pending("document.createElement is not supported in Node.js.");
    }
    const loadingTask = getDocument(buildGetDocumentParams("basicapi.pdf"));
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const { pageWidth, pageX } = viewport.rawDims;
    // Badly rounded with two decimals: 10.00% instead of 10.0045%.
    const left = (pageWidth * 10.0045) / 100;

    const textLayer = new TextLayer({
      textContentSource: {
        items: [
          {
            str: "Hello",
            dir: "ltr",
            width: 30,
            height: 10,
            transform: [10, 0, 0, 10, pageX + left, 100],
            fontName: "f1",
            hasEOL: false,
          },
          {
            str: "X",
            dir: "ltr",
            width: 10,
            height: 10,
            transform: [0, 10, -10, 0, 50, 100],
            fontName: "f1",
            hasEOL: false,
          },
          {
            str: "X",
            dir: "ltr",
            width: 10,
            height: 10,
            transform: [10, 0, 2, 10, 50, 100],
            fontName: "f1",
            hasEOL: false,
          },
        ],
        styles: {
          f1: {
            fontFamily: "sans-serif",
            ascent: 0.8,
            descent: -0.2,
            vertical: false,
          },
        },
        lang: "en",
      },
      container: document.createElement("div"),
      viewport,
    });
    await textLayer.render();

    const { style } = textLayer.textDivs[0];
    expect(
      Math.abs((parseFloat(style.left) * pageWidth) / 100 - left)
    ).toBeLessThan(5e-3);
    const rotated = new DOMMatrix(textLayer.textDivs[1].style.transform);
    expect(rotated.b).toBeCloseTo(-1, 6);
    expect(rotated.c).toBeCloseTo(1, 6);
    const skewed = new DOMMatrix(textLayer.textDivs[2].style.transform);
    expect(skewed.a).toBeCloseTo(1, 6);
    expect(skewed.c / skewed.d).toBeCloseTo(-0.2, 6);
    expect(Math.hypot(skewed.c, skewed.d)).toBeCloseTo(1, 6);

    await loadingTask.destroy();
  });
});
