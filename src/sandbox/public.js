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
/* eslint no-var: error */

import { isPublicProperty } from "../shared/util.js";

class PublicMethods {
  static AFNumber_Format(
    event,
    nDec,
    sepStyle,
    negStyle,
    currStyle,
    strCurrency,
    bCurrencyPrepend
  ) {
    if (event.type !== "Field" || event.name !== "Format" || !event.value) {
      return;
    }

    nDec = Math.abs(nDec);
    let value = event.value.trim().replace(",", ".");
    const number = Number.parseFloat(value);
    value = number.toFixed(nDec);
    if (event.value !== value) {
      event.source.value = value;
      event.value = value;
    }
  }

  static _get(name, event) {
    if (isPublicProperty(PublicMethods, name)) {
      return function (...args) {
        PublicMethods[name](event, ...args);
      };
    }
    return null;
  }
}

export { PublicMethods };
