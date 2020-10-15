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

import { Event, EventDispatcher } from "./event.js";
import { AFormat } from "./aformat.js";
import { App } from "./app.js";
import { Console } from "./console.js";
import { Doc } from "./doc.js";
import { Field } from "./field.js";
import { NotSupportedError } from "./error.js";
import { PDFObject } from "./pdf_object.js";
import { PrintParams } from "./print_params.js";
import { ProxyHandler } from "./proxy.js";
import { Util } from "./util.js";

function generateRandomString(actions) {
  while (true) {
    const name = new Uint8Array(64);
    if (typeof crypto !== "undefined") {
      crypto.getRandomValues(name);
    } else {
      for (let i = 0, ii = name.length; i < ii; i++) {
        name[i] = Math.floor(256 * Math.random());
      }
    }

    const nameString = btoa(
      Array.from(name)
        .map(x => String.fromCharCode(x))
        .join("")
    );
    if (actions.every(action => !action.includes(nameString))) {
      return nameString;
    }
  }
}

function dumpClass(clazz) {
  return clazz
    .toString()
    .replace(/extends _[^\.]*\./, "extends ")
    .replace(/new _[^\.]*\./, "new ")
    .replace(/throw new _error\./g, "throw new ");
}

function generateCode({ document, objects, calculationOrder }) {
  const imports = [
    PDFObject,
    NotSupportedError,
    App,
    Console,
    Doc,
    Event,
    EventDispatcher,
    Field,
    PrintParams,
    AFormat,
    Util,
  ];
  const outputsMap = {
    global: "Object.create(null)",
    app: "new Proxy(_app, proxyHandler)",
    console: "new Proxy(new Console({send}), proxyHandler)",
    util: "new Proxy(_util, proxyHandler)",
  };

  for (const name of Object.getOwnPropertyNames(AFormat.prototype)) {
    if (name.startsWith("AF")) {
      outputsMap[name] = `_aformat.${name}.bind(_aformat)`;
    }
  }

  const allObjects = Object.values(objects).flat(2);
  const allActions = allObjects.map(obj => Object.values(obj.actions)).flat(2);
  const dispatchEventName = generateRandomString(allActions);

  const buf = [];
  buf.push(`const [${Object.keys(outputsMap).join(", ")}] = (function() {`);
  buf.push(`const dispatchEvent = '${dispatchEventName}';`);
  buf.push(`const proxyHandler = ${dumpClass(ProxyHandler)};`);
  buf.push("let obj, wrapped;");

  imports.map(dumpClass).forEach(dumped => buf.push(dumped));
  buf.push("const _doc = new Doc({send});");
  buf.push(
    "const _document = {obj: _doc, wrapped: new Proxy(_doc, proxyHandler)};"
  );

  const CO = JSON.stringify(calculationOrder);
  buf.push(
    `const _app = new App({ send, _document, calculationOrder: ${CO} });`
  );
  buf.push("const _util = new Util({crackURL});");
  buf.push("const _aformat = new AFormat(_doc, _app, _util);");

  for (const [name, objs] of Object.entries(objects)) {
    const obj = objs[0];
    if (false && obj.id === "27R") {
      obj.actions.Action = ["console.println('COUCOU');"];
    }
    buf.push(
      `obj = new Field({...${JSON.stringify(
        obj
      )}, send, doc: _document.wrapped});` +
        "wrapped = new Proxy(obj, proxyHandler);" +
        `_doc._fields['${name}'] = wrapped;` +
        `_app._objects['${obj.id}'] = {obj, wrapped};`
    );
  }

  buf.push(`return [${Object.values(outputsMap).join(", ")}];`);

  // close & call the function
  buf.push("})();");

  return { dispatchEventName, code: buf.join("\n"), initCode: "" };
}

export { generateCode };
