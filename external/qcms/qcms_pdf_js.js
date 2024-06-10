let wasm;

const cachedTextDecoder = new TextDecoder("utf-8", {
  ignoreBOM: true,
  fatal: true,
});

cachedTextDecoder.decode();

let cachedUint8Memory0 = new Uint8Array();

function getUint8Memory0() {
  if (cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

/**
 */
export const DataType = Object.freeze({
  RGB8: 0,
  0: "RGB8",
  RGBA8: 1,
  1: "RGBA8",
  BGRA8: 2,
  2: "BGRA8",
  Gray8: 3,
  3: "Gray8",
  GrayA8: 4,
  4: "GrayA8",
  CMYK: 5,
  5: "CMYK",
});

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1);
  getUint8Memory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

export { initSync };

/**
 */
export const Intent = Object.freeze({
  Perceptual: 0,
  0: "Perceptual",
  RelativeColorimetric: 1,
  1: "RelativeColorimetric",
  Saturation: 2,
  2: "Saturation",
  AbsoluteColorimetric: 3,
  3: "AbsoluteColorimetric",
});

/**
 * @param {number} profile
 */
export function qcms_drop_profile(profile) {
  wasm.qcms_drop_profile(profile);
}

/**
 * @param {number} transform
 */
export function qcms_drop_transform(transform) {
  wasm.qcms_drop_transform(transform);
}

/**
 * @param {Uint8Array} mem
 * @returns {number}
 */
export function qcms_profile_from_memory(mem) {
  const ptr0 = passArray8ToWasm0(mem, wasm.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.qcms_profile_from_memory(ptr0, len0);
  return ret;
}

/**
 * @returns {number}
 */
export function qcms_profile_srgb() {
  const ret = wasm.qcms_profile_srgb();
  return ret;
}

/**
 * @param {number} in_0
 * @param {number} in_type
 * @param {number} out
 * @param {number} out_type
 * @param {number} intent
 * @returns {number}
 */
export function qcms_transform_create(in_0, in_type, out, out_type, intent) {
  const ret = wasm.qcms_transform_create(in_0, in_type, out, out_type, intent);
  return ret;
}

async function load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn(
            "`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",
            e
          );
        } else {
          throw e;
        }
      }
    }

    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  }
  const instance = await WebAssembly.instantiate(module, imports);

  if (instance instanceof WebAssembly.Instance) {
    return { instance, module };
  }
  return instance;
}

function getImports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbindgen_throw = function (arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };

  return imports;
}

function initMemory(imports, maybe_memory) {}

function finalizeInit(instance, module) {
  wasm = instance.exports;
  init.__wbindgen_wasm_module = module;
  cachedUint8Memory0 = new Uint8Array();

  return wasm;
}

function initSync(module) {
  const imports = getImports();

  initMemory(imports);

  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }

  const instance = new WebAssembly.Instance(module, imports);

  return finalizeInit(instance, module);
}

async function init(input) {
  if (input === undefined) {
    input = new URL("qcms_pdf_js_bg.wasm", import.meta.url);
  }
  const imports = getImports();

  if (
    typeof input === "string" ||
    (typeof Request === "function" && input instanceof Request) ||
    (typeof URL === "function" && input instanceof URL)
  ) {
    input = fetch(input);
  }

  initMemory(imports);

  const { instance, module } = await load(await input, imports);

  return finalizeInit(instance, module);
}

/**
 * @param {number} transform
 * @param {Uint8Array} src
 * @param {Uint8Array} dest
 */
export function qcms_transform_data(transform, src, dest) {
  try {
    const ptr0 = passArray8ToWasm0(src, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = passArray8ToWasm0(dest, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    wasm.qcms_transform_data(transform, ptr0, len0, ptr1, len1);
  } finally {
    dest.set(getUint8Memory0().subarray(ptr1 / 1, ptr1 / 1 + len1));
    wasm.__wbindgen_free(ptr1, len1 * 1);
  }
}
export default init;
