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

import { Util } from "../../src/scripting_api/util.js";

describe("Util", function () {
  describe("printd", function () {
    it("should print a date according to a format", function (done) {
      const util = new Util({ send: null });
      const date = new Date("April 15, 1707 3:14:15");
      expect(util.printd("0", date)).toEqual("D:17070415031415");
      expect(util.printd("1", date)).toEqual("1707.04.15 03:14:15");
      expect(util.printd("2", date)).toEqual("4/15/07 3:14:15 am");
      expect(util.printd("mmmm mmm mm m", date)).toEqual("April Apr 04 4");
      expect(util.printd("dddd ddd dd d", date)).toEqual("Friday Fri 15 15");
      done();
    });
  });

  describe("scand", function () {
    it("should parse a date according to a format", function (done) {
      const util = new Util({ send: null });
      const date = new Date("April 15, 1707 3:14:15");
      expect(util.scand("0", "D:17070415031415")).toEqual(date);
      expect(util.scand("1", "1707.04.15 03:14:15")).toEqual(date);
      expect(util.scand("2", "4/15/07 3:14:15 am")).toEqual(
        new Date("April 15, 2007 3:14:15")
      );
      done();
    });
  });
});
