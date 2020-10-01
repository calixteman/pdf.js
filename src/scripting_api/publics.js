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
  static AFNumber_Format(
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
    let number = Number.parseFloat(value);
    if (isNaN(number) || !isFinite(number)) {
      number = 0;
    }
    value = number.toFixed(nDec);
    if (event.value !== value) {
      event.source.value = value;
      event.value = value;
    }
  }
}

export { PublicMethods };
