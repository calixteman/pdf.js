const DEST_BUFFER = {
    buffer: null,
    wasm: null,
};

function copy_result(ptr, len) {
    console.log("copy_result", ptr, len);
    const { wasm, buffer } = DEST_BUFFER;
    const result = new Uint8Array(wasm.memory.buffer, ptr, len);
    for (let i = 0, j = 0, ii = result.length; i < ii; i += 3, j += 4) {
        buffer[j + 0] = result[i + 0];
        buffer[j + 1] = result[i + 1];
        buffer[j + 2] = result[i + 2];
    }
}

export { copy_result, DEST_BUFFER };