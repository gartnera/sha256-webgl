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

function setUniforms(program, data, expected, nonce) {
    const dataLoc = gl.getUniformLocation(program, 'data');
    const expectedLoc = gl.getUniformLocation(program, 'expected');
    const nonceLoc = gl.getUniformLocation(program, 'nonce');

    gl.uniform1uiv(dataLoc, data);
    gl.uniform1uiv(expectedLoc, expected);
    gl.uniform1ui(nonceLoc, nonce);
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

async function render(program, data, expected, nonce) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    setUniforms(program, data, expected, nonce);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();

    // Wait for two animation frames to ensure rendering is complete
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    return true;
}

async function run() {
    document.body.appendChild(canvas);
    const program = await initShaderProgram();
    setupGeometry(program);

    // Generate random data length (between 1 and 55 bytes to fit in single block)
    const initialLength = Math.floor(Math.random() * 55) + 1;

    // Generate random initial data
    const initialData = new Uint8Array(initialLength);
    crypto.getRandomValues(initialData);

    // Hash the initial data
    const hashedBuffer = await crypto.subtle.digest('SHA-256', initialData);
    const data = new Uint8Array(hashedBuffer);  // Always 32 bytes (256 bits)

    let nonce = Math.floor(Math.random() * 100000);
    console.log("random nonce", nonce)

    // Prepare padded data block (512 bits / 64 bytes)
    const paddedData = new Uint8Array(64);
    paddedData.set(data);
    paddedData[data.length + 4] = 0x80;

    // Set message length at the end (in bits)
    const dataView = new DataView(paddedData.buffer);
    dataView.setUint32(60, data.length * 8 + 4*8, false);

    // Convert to 32-bit words
    const dataWords = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
        dataWords[i] = dataView.getUint32(i * 4, false);
    }

    // Create a new array with data and nonce
    const dataWithNonce = new Uint8Array(data.length + 4);
    dataWithNonce.set(data);
    const nonceView = new DataView(dataWithNonce.buffer);
    nonceView.setUint32(data.length, nonce, false);

    // Get expected hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataWithNonce);
    const expectedHash = new Uint32Array(8);
    const hashView = new DataView(hashBuffer);
    for (let i = 0; i < 8; i++) {
        expectedHash[i] = hashView.getUint32(i * 4, false);
    }

    const renderComplete = await render(program, dataWords, expectedHash, nonce);
    if (renderComplete) {
        console.log('Rendering completed successfully');
        console.log('Initial data (hex):', Array.from(initialData).map(b => b.toString(16).padStart(2, '0')).join(''));
        console.log('Input data (hex):', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(''));
        console.log('Data with nonce (hex):', Array.from(dataWithNonce).map(b => b.toString(16).padStart(2, '0')).join(''));
        console.log('Expected hash (hex):', Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join(''));
    } else {
        console.warn('Rendering may not have completed');
    }
}
run();