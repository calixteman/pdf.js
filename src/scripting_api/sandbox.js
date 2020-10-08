import ModuleLoader from "./quickjs-eval.js";

class Sandbox {
  constructor(module) {
    this._eval = module.cwrap("eval", null, ["string"]);
    this.dispatchEventName = null;
  }

  create(code) {
    this.dispatchEventName = code.dispatchEventName;
    // this._eval("try { " + code.code + "} catch (error) {debugMe(error.message);}");
    this._eval(code.code);
    this._eval(
      [
        "delete send;",
        "delete setTimeout;",
        "delete clearTimeout;",
        "delete setInterval;",
        "delete clearInterval;",
      ].join("")
    );
  }

  dispatchEvent(data) {
    if (this.dispatchEventName === null) {
      throw new Error("Sandbox must have been initialized");
    }
    const event = JSON.stringify(data);
    this._eval(`event = null; app['${this.dispatchEventName}'](${event});`);
  }
}

function QuickJSSandbox() {
  const promise = ModuleLoader().then(module => {
    return new Sandbox(module);
  });
  return {
    createSandbox(code) {
      promise.then(sbx => sbx.create(code));
    },
    dispatchEventInSandbox(data) {
      promise.then(sbx => sbx.dispatchEvent(data));
    },
  };
}

export { QuickJSSandbox };
