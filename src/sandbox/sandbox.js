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

import { AnnotationType, WidgetType } from "../shared/util.js";
import { Console, Event, Field } from "./objects.js";
import { PublicMethods } from "./public.js";

class Sender {
  constructor(window, origin) {
    this._window = window;
    this._origin = origin;
  }

  send(id, data) {
    this._window.postMessage({ id, data }, this._origin);
  }
}

class Context {
  constructor(sender) {
    this.event = null;
    this.reset();
  }

  reset() {
    this.global = {
      console: new Console(),
    };
  }
}

class MessageHandler {
  constructor(window, origin) {
    this._objects = Object.create(null);
    this._context = new Context();
    this._sender = new Sender(window, origin);
    this._proxiedContext = new Proxy(this._context, {
      get(obj, prop) {
        // we return only what the user defined or what we accept
        if (obj.global.hasOwnProperty(prop)) {
          return obj.global[prop];
        }

        const meth = PublicMethods._get(prop, obj.event);
        if (meth !== null) {
          return meth;
        }

        return undefined;
      },

      set(obj, prop, value) {
        obj.global[prop] = value;
        return true;
      },

      has(obj, prop) {
        // the context has all properties
        // and when an undefined one is got
        // then we return undefined.
        // For example if the script tries to get "window"
        // thanks to "return true" we won't try to get it
        // in the global scope.
        return true;
      },
    });
  }

  handle(message) {
    if (message.name === "Event") {
      const obj = this._objects[message.id];
      if (obj && obj.real._isListeningFor(message.event.name)) {
        const { real, proxy } = Event._new(message.event, message.id);

        // need to inject the event in the context
        // to be used in public functions (see public.js)
        this._context.event = real;

        real.source = real.target = obj.proxy;

        // Make the event available to the script
        this._proxiedContext.event = proxy;

        obj.real._dispatch(message.event.name, this._proxiedContext);
      }
      obj.real[message.field] = event.value;
    } else if (message.name === "Create") {
      // TODO: virer le 0 a la fin
      for (const obj of message.value[0]) {
        if (obj === null) {
          continue;
        }
        switch (obj.type) {
          case AnnotationType.WIDGET:
            switch (obj.subtype) {
              case WidgetType.TEXT:
                this._objects[obj.id] = Field._new(
                  {
                    value: obj.value,
                    actions: obj.actions,
                  },
                  obj.id,
                  this._sender
                );
                break;
            }
            break;
        }
      }
    }
  }
}

export { MessageHandler };
