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

class Event {
  constructor(data) {
    this.change = data.change || "";
    this.changeEx = data.changeEx || null;
    this.commitKey = data.commitKey || 0;
    this.fieldFull = data.fieldFull || false;
    this.keyDown = data.keyDown || false;
    this.modifier = data.modifier || false;
    this.name = data.name;
    this.rc = true;
    this.richChange = data.richChange || [];
    this.richChangeEx = data.richChangeEx || [];
    this.richValue = data.richValue || [];
    this.selEnd = data.selEnd || 0;
    this.selStart = data.selStart || 0;
    this.shift = data.shift || false;
    this.source = data.source || null;
    this.target = data.target || null;
    this.targetName = data.targetName || "";
    this.type = "Field";
    this.value = data.value || null;
    this.willCommit = data.willCommit || false;
  }
}

class EventDispatcher {
  constructor(document, calculationOrder, objects) {
    this._document = document;
    this._calculationOrder = calculationOrder;
    this._objects = objects;
  }

  dispatch(baseEvent) {
    const id = baseEvent.id;
    if (!(id in this._objects)) {
      return;
    }

    const name = baseEvent.name.replace(" ", "");
    const source = this._objects[id];
    const event = (this._document.obj._event = new Event(baseEvent));

    if (name === "KeyStroke" && event.willCommit) {
      this.runValidation(source, event);
    }
    this.runActions(source, source, event, name);
  }

  runValidation(source, event) {
    let oldValue = source.obj.value;
    this.runActions(source, source, event, "Validate");
    if (event.rc) {
      if (oldValue !== event.value) {
        source.obj.value = oldValue = event.value;
      }

      this.runCalculate(source, event);

      event.value = oldValue;
      this.runActions(source, source, event, "Format");
      if (oldValue !== event.value) {
        source.wrapped.value = event.value;
      }
    }
  }

  runActions(source, target, event, eventName) {
    event.source = source.wrapped;
    event.target = target.wrapped;
    event.name = eventName;
    event.rc = true;
    if (!target.obj._runActions(event)) {
      return true;
    }
    return event.rc;
  }

  runCalculate(source, event) {
    if (this._calculationOrder.length === 0) {
      return;
    }

    for (const targetId of this._calculationOrder) {
      if (!(targetId in this._objects)) {
        continue;
      }

      const target = this._objects[targetId];
      const oldValue = (event.value = target.obj.value);
      this.runActions(source, target, event, "Calculate");
      this.runActions(target, target, event, "Validate");
      if (!event.rc) {
        continue;
      }

      if (oldValue !== event.value) {
        target.obj.value = event.value;
      }

      this.runActions(target, target, event, "Format");
      if (oldValue !== event.value) {
        target.wrapped.value = event.value;
      }
    }
  }
}

export { Event, EventDispatcher };
