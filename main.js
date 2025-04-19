const canvas = document.getElementById("sha256-canvas")
const gl = canvas.getContext('webgl2');
if (!gl) {
    console.error('WebGL 2.0 not supported');
    throw new Error('WebGL 2.0 not supported');
}

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
    canvas.width = 1;
    canvas.height = 1;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const nonceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, nonceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, 1, 1, 0, gl.RED_INTEGER, gl.INT, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nonceTexture, 0);

    const hash0Texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hash0Texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, hash0Texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    gl.useProgram(program);
    setUniforms(program, data, difficulty, baseNonce);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();

    const nonce = new Int32Array(1);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, 1, 1, gl.RED_INTEGER, gl.INT, nonce);

    const hash0 = new Uint32Array(1);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(0, 0, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_INT, hash0);

    gl.deleteFramebuffer(fb);
    gl.deleteTexture(nonceTexture);
    gl.deleteTexture(hash0Texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { nonce: nonce[0], hash0: hash0[0] };
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
    // use baseNonce to calculate in smaller batches to avoid full window hangs or GPU timeouts
    for (let i = 0; i < 200; i++) {
        const baseNonce = i * 100000;
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