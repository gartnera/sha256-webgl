const canvas = document.getElementById("sha256-canvas")
const gl = canvas.getContext('webgl2');
if (!gl) {
    console.error('WebGL 2.0 not supported');
    throw new Error('WebGL 2.0 not supported');
}

const GRID_SIZE = 32;
// WARN: increasing this value beyond 1000 is unstable on macOS safari
// WARN: increasing this value beyond 10 is unstable on iOS safari
const NONCES_PER_PIXEL = 10;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const vertexShaderSource = `#version 300 es
    in vec4 position;
    void main() {
        gl_Position = position;
    }
`;

async function initShaderProgram() {
    const response = await fetch('/shader.glsl');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const fragmentShaderSource = await response.text();

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('Shader program link failed: ' + gl.getProgramInfoLog(program));
    }

    return program;
}

function setUniforms(program, data, difficulty, baseNonce) {
    const dataLoc = gl.getUniformLocation(program, 'data');
    const difficultyLoc = gl.getUniformLocation(program, 'difficulty');
    const baseNonceLoc = gl.getUniformLocation(program, 'baseNonce');
    gl.uniform1uiv(dataLoc, data);
    gl.uniform1ui(difficultyLoc, difficulty);
    gl.uniform1i(baseNonceLoc, baseNonce);
}

function setupGeometry(program) {
    const positions = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
}

async function render(program, data, difficulty, baseNonce) {
    // Set up grid for parallel processing
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    gl.viewport(0, 0, GRID_SIZE, GRID_SIZE);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    // Create texture for nonce results (one per pixel)
    const nonceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, nonceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, GRID_SIZE, GRID_SIZE, 0, gl.RED_INTEGER, gl.INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nonceTexture, 0);

    // Create texture for hash results (one per pixel)
    const hash0Texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hash0Texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, GRID_SIZE, GRID_SIZE, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, hash0Texture, 0);

    // Create color texture for visualization
    const colorTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRID_SIZE, GRID_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

    // Enable all color attachments
    gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2
    ]);

    // Check framebuffer status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer is not complete. Status: ${status}`);
    }

    // Run the shader
    gl.useProgram(program);
    setUniforms(program, data, difficulty, baseNonce);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();

    // Read results from all pixels
    // gl.RED_INTEGER is not supported on firefox, so just read the full gl.RGBA_INTEGER
    const nonces = new Int32Array(GRID_SIZE * GRID_SIZE);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);

    const tempNonces = new Int32Array(GRID_SIZE * GRID_SIZE * 4);
    gl.readPixels(0, 0, GRID_SIZE, GRID_SIZE, gl.RGBA_INTEGER, gl.INT, tempNonces);
    // Extract only the R component
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        nonces[i] = tempNonces[i * 4];
    }

    const hashes = new Uint32Array(GRID_SIZE * GRID_SIZE);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);

    const tempHashes = new Uint32Array(GRID_SIZE * GRID_SIZE * 4);
    gl.readPixels(0, 0, GRID_SIZE, GRID_SIZE, gl.RGBA_INTEGER, gl.UNSIGNED_INT, tempHashes);
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        hashes[i] = tempHashes[i * 4];
    }

    // Find the first successful result`
    let foundNonce = -1;
    let foundHash = 0;
    for (let i = 0; i < nonces.length; i++) {
        if (nonces[i] !== -1) {
            foundNonce = nonces[i];
            foundHash = hashes[i];
            break;
        }
    }

    // Cleanup
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(nonceTexture);
    gl.deleteTexture(hash0Texture);
    gl.deleteTexture(colorTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {
        nonce: foundNonce,
        hash0: foundHash,
        totalProcessed: GRID_SIZE * GRID_SIZE * NONCES_PER_PIXEL,
    };
}

function uint32hex(number) {
    return number.toString(16).padStart(8, '0');
}

// WARN: difficulty > 6 is broken right now, the gpu hash will mismatch the cpu hash. might be a nonce encoding issue.
async function run(inputData, difficulty) {
    const startTime = performance.now();

    document.body.appendChild(canvas);
    const program = await initShaderProgram();
    setupGeometry(program);

    const encoder = new TextEncoder();
    const inputBuffer = encoder.encode(inputData);
    const hashedBuffer = await crypto.subtle.digest('SHA-256', inputBuffer);
    const data = new Uint8Array(hashedBuffer);

    const paddedData = new Uint8Array(64);
    paddedData.set(data);
    paddedData[data.length + 4] = 0x80;

    const dataView = new DataView(paddedData.buffer);
    dataView.setUint32(60, data.length * 8 + 4 * 8, false);

    const dataWords = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
        dataWords[i] = dataView.getUint32(i * 4, false);
    }

    let result = null;
    const noncesPerFrame = GRID_SIZE * GRID_SIZE * NONCES_PER_PIXEL;
    for (let i = 0; i < 1000; i++) {
        const baseNonce = i * noncesPerFrame;
        result = await render(program, dataWords, difficulty, baseNonce);
        if (result.nonce != -1) {
            break;
        }
    }
    let hash0Hex = uint32hex(result.hash0);

    if (result.nonce >= 0) {
        const dataWithNonce = new Uint8Array(data.length + 4);
        dataWithNonce.set(data);
        const nonceView = new DataView(dataWithNonce.buffer);
        nonceView.setUint32(data.length, result.nonce, false);

        const finalHash = await crypto.subtle.digest('SHA-256', dataWithNonce);
        const hashHexString = Array.from(new Uint8Array(finalHash)).map(b => b.toString(16).padStart(2, '0')).join('')
        const cpuHash0Hex = hashHexString.slice(0, 8);

        if (hash0Hex !== cpuHash0Hex) {
            throw new Error(`Hash mismatch: GPU hash0 ${hash0Hex} !== CPU hash0 ${cpuHash0Hex}`);
        }
        const endTime = performance.now();

        return {
            inputHash: Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(''),
            hash: hashHexString,
            nonce: result.nonce,
            duration: startTime - endTime,
        }
    } else {
        return {
            nonce: result.nonce,
        }
    }
}

const inputDataEl = document.getElementById("inputData");
const difficultyEl = document.getElementById("difficulty");
const errorEl = document.getElementById("error");
const inputHashEl = document.getElementById("inputHash");
const finalHashEl = document.getElementById("finalHash");
const nonceEl = document.getElementById("nonce");

function setRandomInput() {
    inputDataEl.value = Math.random().toString(36).substring(2, 10);
}

async function handleCalculateClick(ev) {
    document.querySelectorAll("button").forEach((btn) => btn.disabled = true);
    const inputData = inputDataEl.value;
    const difficulty = parseInt(difficultyEl.value);
    errorEl.style.display = "none";
    try {
        const res = await run(inputData, difficulty);
        inputHashEl.value = res.inputHash;
        finalHashEl.value = res.hash;
        nonceEl.value = res.nonce;
    } catch (e) {
        errorEl.style.display = "block";
        errorEl.innerText = e;
    }
    document.querySelectorAll("button").forEach((btn) => btn.disabled = false);
}

document.getElementById("calculate").addEventListener("click", handleCalculateClick);
document.getElementById("calculate-random").addEventListener("click", async () => {
    setRandomInput();
    await handleCalculateClick();
});