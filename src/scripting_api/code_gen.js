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

import { App } from "./app.js";
import { Console } from "./console.js";
import { Doc } from "./doc.js";
import { Field } from "./field.js";
import { NotSupportedError } from "./error.js";
import { PDFObject } from "./pdf_object.js";
import { PrintParams } from "./print_params.js";
import { ProxyHandler } from "./proxy.js";
import { PublicMethods } from "./publics.js";
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
    .replace(/throw new _error\./g, "throw new ");
}

function generateCode({ document, objects }) {
  const imports = [
    PDFObject,
    NotSupportedError,
    App,
    Console,
    Doc,
    Field,
    PrintParams,
    Util,
  ];
  const outputsMap = {
    global: "Object.create(null)",
    app: "new Proxy(_app, proxyHandler)",
    console: "new Proxy(new Console({send}), proxyHandler)",
    util: "new Proxy(new Util({crackURL}), proxyHandler)",
  };

  objects = Object.values(objects).flat(2);
  const allActions = objects.map(obj => Object.values(obj.actions)).flat(2);
  const dispatchEventName = generateRandomString(allActions);

  const buf = Object.getOwnPropertyNames(PublicMethods)
    .filter(name => name.startsWith("AF"))
    .map(name => `function ${PublicMethods[name].toString()}`);

  buf.push(`const [${Object.keys(outputsMap).join(", ")}] = (function() {`);
  buf.push(`const dispatchEvent = '${dispatchEventName}';`);
  buf.push(`const proxyHandler = ${dumpClass(ProxyHandler)};`);
  buf.push("let temp;");

  imports.map(dumpClass).forEach(dumped => buf.push(dumped));
  buf.push("const _app = new App({send, _document: new Doc({send})});");

  for (const obj of objects) {
    if (false && obj.id === "436R") {
      obj.actions.Format = [
        "event.target.value = this.getPrintParams().constants.flagValues.emitPostScriptXObjects",
      ];
    }
    buf.push(
      `temp = new Field({...${JSON.stringify(obj)}` +
        `, send});_app._objects['${obj.id}'] = ` +
        "{obj: temp, wrapped: new Proxy(temp, proxyHandler)};"
    );
  }

  buf.push(`return [${Object.values(outputsMap).join(", ")}];`);

  // close & call the function
  buf.push("})();");

  return { dispatchEventName, code: buf.join(""), initCode: "" };
}

export { generateCode };
