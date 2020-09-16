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

import {
  createAction,
  isPublicProperty,
  ListenerType,
} from "../shared/util.js";

const objectProxyHandler = {
  get(obj, prop) {
    // script may add some properties to the object
    if (obj._fake.hasOwnProperty(prop)) {
      return obj._fake[prop];
    }

    if (isPublicProperty(obj, prop)) {
      // return only public properties
      // i.e. the ones not starting with a '_'
      return obj[prop];
    }

    return undefined;
  },

  set(obj, prop, value) {
    if (isPublicProperty(obj, prop)) {
      obj[prop] = value;
      if (obj._sender) {
        const data = Object.create([]);
        data[prop] = value;

        // send the updated value to the other side
        obj._sender.send(obj._id, data);
      }
    } else {
      obj._fake[prop] = value;
    }
    return true;
  },

  has(obj, prop) {
    return obj._fake.hasOwnProperty(prop) || isPublicProperty(obj, prop);
  },
};

class FakeObject {
  constructor(sender) {
    // the _fake object is used to add extra properties
    // to the object
    this._fake = Object.create([]);
    this._sender = sender;
  }
}

class Listeners {
  constructor() {
    this.listeners = new Array(Object.keys(ListenerType).length).fill([]);
  }

  addEventListener(type, listener) {
    const action = createAction(listener);
    if (action !== null) {
      this.listeners[type].push(action);
    }
  }

  dispatch(type, id, context) {
    const listeners = this.listeners[type];
    for (const action of listeners) {
      action(context);
    }
  }

  isListeningFor(type) {
    return this.listeners[type].length !== 0;
  }
}

class Event extends FakeObject {
  constructor(data) {
    super(null);
    this.change = data.change || "";
    this.changeEx = data.changeEx || null;
    this.commitKey = data.commitKey || 0;
    this.fieldFull = data.fieldFull || false;
    this.keyDown = data.keyDown || false;
    this.modifier = data.modifier || false;
    this.name = data.name;
    this.rc = data.rc;
    this.richChange = data.richChange || [];
    this.richChangeEx = data.richChangeEx || [];
    this.richValue = data.richValue || [];
    this.selEnd = data.selEnd || 0;
    this.selStart = data.selStart || 0;
    this.shift = data.shift || false;
    this.source = data.source || null;
    this.target = data.target || null;
    this.targetName = data.targetName || "";
    this.type = data.type || "";
    this.value = data.value || null;
    this.willCommit = data.willCommit || false;
  }

  static _new(data) {
    const instance = new Event(data);
    return { real: instance, proxy: new Proxy(instance, objectProxyHandler) };
  }
}

class Console extends FakeObject {
  constructor() {
    super(null);
  }

  clear() {
    console.clear();
  }

  hide() {
    // not implemented
  }

  println(str) {
    if (typeof str === "string") {
      console.log(str);
    }
  }

  show() {
    // not implemented
  }
}

class Annotation extends FakeObject {
  constructor(id, actions, sender) {
    super(sender);
    this._id = id;
    this._listeners = new Listeners();

    for (const [type, action] of Object.entries(actions)) {
      this._listeners.addEventListener(type, action);
    }
  }

  _dispatch(type, context) {
    this._listeners.dispatch(ListenerType[type], this._id, context);
  }

  _isListeningFor(type) {
    return (
      ListenerType.hasOwnProperty(type) &&
      this._listeners.isListeningFor(ListenerType[type])
    );
  }
}

class Field extends Annotation {
  constructor({ value, actions }, id, sender) {
    super(id, actions, sender);
    this.value = value;
  }

  static _new(data, id, sender) {
    const instance = new Field(data, id, sender);
    return { real: instance, proxy: new Proxy(instance, objectProxyHandler) };
  }
}

export { Console, Event, ListenerType, Field };
