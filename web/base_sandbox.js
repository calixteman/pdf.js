function sandboxLoad() {
  Promise.all([import("pdfjs/sandbox/sandbox.js")]).then(function ([sandbox]) {
    window.addEventListener("message", function (e) {
      if (e.origin !== window.location.protocol + "//" + window.location.host) {
        return;
      }

      if (!window.messageHandler) {
        window.messageHandler = new sandbox.MessageHandler(e.source, e.origin);
      }

      window.messageHandler.handle(e.data);
    });
  });
}

sandboxLoad();
