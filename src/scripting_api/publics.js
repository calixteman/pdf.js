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

class PublicMethods {
  constructor(document) {
    this._document = document;
  }

  AFMakeNumber(str) {
    if (typeof str === "number") {
      return str;
    }
    if (typeof str !== "string") {
      return 0;
    }

    str = str.trim().replace(",", ".");
    const number = Number.parseFloat(str);
    if (isNaN(number) || !isFinite(number)) {
      return 0;
    }
    return number;
  }

  AFNumber_Format(
    nDec,
    sepStyle,
    negStyle,
    currStyle,
    strCurrency,
    bCurrencyPrepend
  ) {
    const event = this._document._event;
    if (event.type !== "Field" || !event.value) {
      return;
    }

    nDec = Math.abs(nDec);
    const number = this.AFMakeNumber(event.value);
    event.value = number.toFixed(nDec);
  }

  AFSimple_Calculate(cFunction, cFields) {
    const actions = {
      AVG(args) {
        return args.reduce((acc, value) => acc + value, 0) / args.length;
      },
      SUM(args) {
        return args.reduce((acc, value) => acc + value, 0);
      },
      PRD(args) {
        return args.reduce((acc, value) => acc * value, 1);
      },
      MIN(args) {
        return args.reduce(
          (acc, value) => Math.min(acc, value),
          Number.MAX_VALUE
        );
      },
      MAX(args) {
        return args.reduce(
          (acc, value) => Math.max(acc, value),
          Number.MIN_VALUE
        );
      },
    };

    if (!(cFunction in actions)) {
      throw new TypeError("Invalid function in AFSimple_Calculate");
    }

    const event = this._document._event;
    const values = [];
    for (const cField of cFields) {
      const field = this._document.getField(cField);
      switch (field.type) {
        case "text":
        case "combobox":
        case "listbox":
          values.push(this.AFMakeNumber(field.value));
          break;
        case "checkbox":
        case "radio":
          // TODO: get exportValue
          break;
      }
    }

    if (values.length === 0) {
      event.value = "0";
      return;
    }

    const res = actions[cFunction](values);
    event.value = (Math.round(1e6 * res) / 1e6).toString();
  }
}

export { PublicMethods };
