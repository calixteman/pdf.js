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

import { PDFObject } from "./pdf_object.js";

class Util extends PDFObject {
  constructor(data) {
    super(data);

    this._crackURL = data.crackURL;
    this._scandCache = Object.create(null);
    this._months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    this._days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
  }

  crackURL(cURL) {
    return this._crackURL(cURL);
  }

  printf(...args) {
    if (args.length === 0) {
      throw new Error("Invalid number of params in printf");
    }

    if (typeof args[0] !== "string") {
      throw new TypeError("First argument of printf must be a string");
    }

    const pattern = /%(,[0-9])?([\+ 0#]+)?([0-9]+)?(\.[0-9]+)?([dfsx])/g;
    const PLUS = 1;
    const SPACE = 2;
    const ZERO = 4;
    const HASH = 8;
    let i = 0;
    return args[0].replace(pattern, function (match, p1, p2, p3, p4, p5) {
      i++;
      if (i === args.length) {
        throw new Error("Not enough arguments in printf");
      }
      const arg = args[i];
      const cConvChar = p5;

      if (cConvChar === "s") {
        return arg.toString();
      }

      let cFlags = 0;
      if (p2) {
        for (const c of p2) {
          switch (c) {
            case "+":
              cFlags = cFlags | PLUS;
              break;
            case " ":
              cFlags = cFlags | SPACE;
              break;
            case "0":
              cFlags = cFlags | ZERO;
              break;
            case "#":
              cFlags = cFlags | HASH;
              break;
          }
        }
      }

      let nWidth;
      if (p3) {
        nWidth = parseInt(p3);
      }

      let intPart = Math.trunc(arg);

      if (cConvChar === "x") {
        let hex = Math.abs(intPart).toString(16).toUpperCase();
        if (nWidth !== undefined) {
          hex = hex.padStart(nWidth, cFlags & ZERO ? "0" : " ");
        }
        if (cFlags & HASH) {
          hex = `0x${hex}`;
        }
        return hex;
      }

      const nDecSep = p1 ? p1.substring(1) : "0";
      let nPrecision;
      if (p4) {
        nPrecision = parseInt(p4.substring(1));
      }

      const separators = {
        0: [",", "."],
        1: ["", "."],
        2: [".", ","],
        3: ["", ","],
      };
      const [thousandSep, decimalSep] =
        nDecSep in separators ? separators[nDecSep] : ["'", "."];

      let decPart = "";
      if (cConvChar === "f") {
        if (nPrecision !== undefined) {
          decPart = (arg - intPart).toFixed(nPrecision);
        } else {
          decPart = (arg - intPart).toString();
        }
        if (decPart.length > 2) {
          decPart = `${decimalSep}${decPart.substring(2)}`;
        } else if (cFlags & HASH) {
          decPart = ".";
        } else {
          decPart = "";
        }
      }

      let prefix = "";
      if (intPart < 0) {
        prefix = "-";
        intPart = -intPart;
      } else if (cFlags & PLUS) {
        prefix = "+";
      } else if (cFlags & SPACE) {
        prefix = " ";
      }

      if (thousandSep && intPart >= 1000) {
        const buf = [];
        while (true) {
          buf.push((intPart % 1000).toString().padStart(3, "0"));
          intPart = Math.trunc(intPart / 1000);
          if (intPart < 1000) {
            buf.push(intPart.toString());
            break;
          }
        }
        intPart = buf.reverse().join(thousandSep);
      } else {
        intPart = intPart.toString();
      }

      const n = `${prefix}${intPart}${decPart}`;
      if (nWidth !== undefined) {
        return n.padStart(nWidth, cFlags & ZERO ? "0" : " ");
      }

      return n;
    });
  }

  iconStreamFromIcon() {
    /* Not implemented */
  }

  printd(cFormat, cDate) {
    switch (cFormat) {
      case "0":
        return this.printd("D:yyyymmddHHMMss", cDate);
      case "1":
        return this.printd("yyyy.mm.dd HH:MM:ss", cDate);
      case "2":
        return this.printd("m/d/yy h:MM:ss tt", cDate);
    }

    const handlers = {
      mmmm(data) {
        return this._months[data.month];
      },
      mmm(data) {
        return this._months[data.month].substring(0, 3);
      },
      mm(data) {
        return (data.month + 1).toString().padStart(2, "0");
      },
      m(data) {
        return (data.month + 1).toString();
      },
      dddd(data) {
        return this._days[data.dayOfWeek];
      },
      ddd(data) {
        return this._days[data.dayOfWeek].substring(0, 3);
      },
      dd(data) {
        return data.day.toString().padStart(2, "0");
      },
      d(data) {
        return data.day.toString();
      },
      yyyy(data) {
        return data.year.toString();
      },
      yy(data) {
        return (data.year % 100).toString().padStart(2, "0");
      },
      HH(data) {
        return data.hours.toString().padStart(2, "0");
      },
      H(data) {
        return data.hours.toString();
      },
      hh(data) {
        return (data.hours % 12).toString().padStart(2, "0");
      },
      h(data) {
        return (data.hours % 12).toString();
      },
      MM(data) {
        return data.minutes.toString().padStart(2, "0");
      },
      M(data) {
        return data.minutes.toString();
      },
      ss(data) {
        return data.seconds.toString().padStart(2, "0");
      },
      s(data) {
        return data.seconds.toString();
      },
      tt(data) {
        return data.hours < 12 ? "am" : "pm";
      },
      t(data) {
        return data.hours < 12 ? "a" : "p";
      },
    };

    const year = cDate.getFullYear();
    const month = cDate.getMonth();
    const day = cDate.getDate();
    const dayOfWeek = cDate.getDay();
    const hours = cDate.getHours();
    const minutes = cDate.getMinutes();
    const seconds = cDate.getSeconds();
    const data = { year, month, day, dayOfWeek, hours, minutes, seconds };

    const pattern = /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t|\\.)/g;
    return cFormat.replace(pattern, function (match, p1) {
      if (p1 in handlers) {
        return handlers[p1](data);
      }
      return p1.charCodeAt(1);
    });
  }

  printx(cFormat, cSource) {
    // case
    const handlers = [x => x, x => x.toUpperCase(), x => x.toLowerCase()];

    // limits
    const [LA, LZ, UA, UZ, ZER, NIN] = Array.from("azAZ09").map(c =>
      c.charCodeAt(0)
    );

    const buf = [];
    let i = 0;
    const ii = cSource.length;
    let currCase = handlers[0];
    let escaped = false;

    for (const command in cFormat) {
      if (escaped) {
        buf.push(command);
        escaped = false;
        continue;
      }
      if (i >= ii) {
        break;
      }
      switch (command) {
        case "?":
          buf.push(currCase(cSource.charAt(i++)));
          break;
        case "X":
          while (i < ii) {
            const code = cSource.charCodeAt(i++);
            if (
              (LA <= code && code <= LZ) ||
              (UA <= code && code <= UZ) ||
              (ZER <= code && code <= NIN)
            ) {
              buf.push(currCase(String.fromCharCode(code)));
              break;
            }
          }
          break;
        case "A":
          while (i < ii) {
            const code = cSource.charCodeAt(i++);
            if ((LA <= code && code <= LZ) || (UA <= code && code <= UZ)) {
              buf.push(currCase(String.fromCharCode(code)));
              break;
            }
          }
          break;
        case "9":
          while (i < ii) {
            const code = cSource.charCodeAt(i++);
            if (ZER <= code && code <= NIN) {
              buf.push(String.fromCharCode(code));
              break;
            }
          }
          break;
        case "*":
          while (i < ii) {
            buf.push(currCase(cSource.charAt(i++)));
          }
          break;
        case "\\":
          escaped = true;
          break;
        case ">":
          currCase = handlers[1];
          break;
        case "<":
          currCase = handlers[2];
          break;
        case "=":
          currCase = handlers[0];
          break;
        default:
          buf.push(command);
      }
    }

    return buf.join("");
  }

  scand(cFormat, cDate) {
    switch (cFormat) {
      case "0":
        return this.scand("D:yyyymmddHHMMss", cDate);
      case "1":
        return this.scand("yyyy.mm.dd HH:MM:ss", cDate);
      case "2":
        return this.scand("m/d/yy h:MM:ss tt", cDate);
    }

    if (!cFormat in this.scandCache) {
      const handlers = {
        mmmm() {
          return {
            pat: `(${this._months.join("|")})`,
            action(value, data) {
              data.month = this._months.indexOf(value);
            },
          };
        },
        mmm() {
          return {
            pat: `(${this._months
              .map(month => month.substring(0, 3))
              .join("|")})`,
            action(value, data) {
              data.month = this._months.findIndex(
                month => month.substring(0, 3) === value
              );
            },
          };
        },
        mm() {
          return {
            pat: `([0-9]{2})`,
            action(value, data) {
              data.month = parseInt(value) - 1;
            },
          };
        },
        m() {
          return {
            pat: `([0-9]{1,2})`,
            action(value, data) {
              data.month = parseInt(value) - 1;
            },
          };
        },
        dddd() {
          return {
            pat: `(${this._days.join("|")})`,
            action(value, data) {
              data.day = this._days.indexOf(value);
            },
          };
        },
        ddd() {
          return {
            pat: `(${this._days.map(day => day.substring(0, 3)).join("|")})`,
            action(value, data) {
              data.day = this._days.findIndex(
                day => day.substring(0, 3) === value
              );
            },
          };
        },
        dd() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.day = parseInt(value);
            },
          };
        },
        d() {
          return {
            pat: "([0-9]{1,2})",
            action(value, data) {
              data.day = parseInt(value);
            },
          };
        },
        yyyy() {
          return {
            pat: "([0-9]{4})",
            action(value, data) {
              data.year = parseInt(value);
            },
          };
        },
        yy() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.year = 2000 + parseInt(value);
            },
          };
        },
        HH() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.hours = parseInt(value);
            },
          };
        },
        H() {
          return {
            pat: "([0-9]{1,2})",
            action(value, data) {
              data.hours = parseInt(value);
            },
          };
        },
        hh() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.hours = parseInt(value);
            },
          };
        },
        h() {
          return {
            pat: "([0-9]{1,2})",
            action(value, data) {
              data.hours = parseInt(value);
            },
          };
        },
        MM() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.minutes = parseInt(value);
            },
          };
        },
        M() {
          return {
            pat: "([0-9]{1,2})",
            action(value, data) {
              data.minutes = parseInt(value);
            },
          };
        },
        ss() {
          return {
            pat: "([0-9]{2})",
            action(value, data) {
              data.seconds = parseInt(value);
            },
          };
        },
        s() {
          return {
            pat: "([0-9]{1,2})",
            action(value, data) {
              data.seconds = parseInt(value);
            },
          };
        },
        tt() {
          return {
            pat: "([aApP][mM])",
            action(value, data) {
              const char = value.charAt(0);
              data.am = char === "a" || char === "A";
            },
          };
        },
        t() {
          return {
            pat: "([aApP])",
            action(value, data) {
              data.am = value === "a" || value === "A";
            },
          };
        },
      };

      // escape the string
      cFormat = cFormat.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");

      const pattern = /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t)/g;
      const actions = [];

      const re = cFormat.replace(pattern, function (match, p1) {
        const { pat, action } = handlers[p1]();
        actions.push(action);
        return pat;
      });

      this.scandCache[cFormat] = [new RegExp(re, "g"), actions];
    }

    const [regexForFormat, actions] = this.scandCache[cFormat];

    const matches = regexForFormat.exec(cDate);
    if (matches.length !== actions.length + 1) {
      throw new Error("Invalid date util.scand");
    }

    const data = {
      year: 0,
      month: 0,
      day: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      am: true,
    };
    actions.forEach((action, i) => action(matches[i + 1], data));
    if (!data.am) {
      data.hours += 12;
    }

    return new Date(
      data.year,
      data.month,
      data.day,
      data.hours,
      data.minutes,
      data.seconds
    );
  }

  spansToXML() {
    /* Not implemented */
  }

  stringFromStream() {
    /* Not implemented */
  }

  xmlToSpans() {
    /* Not implemented */
  }
}

export { Util };
