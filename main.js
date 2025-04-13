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
function setUniforms(program, data, expected) {
    const dataLoc = gl.getUniformLocation(program, 'data');
    const expectedLoc = gl.getUniformLocation(program, 'expected');

    gl.uniform1uiv(dataLoc, data);
    gl.uniform1uiv(expectedLoc, expected);
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

function render(program, data, expected) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    setUniforms(program, data, expected);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

async function run() {
    document.body.appendChild(canvas);
    const program = await initShaderProgram();
    setupGeometry(program);

    const testString = "Hello, World!";
    const encoder = new TextEncoder();
    const data = encoder.encode(testString);

    // Prepare padded data block (512 bits / 64 bytes)
    const paddedData = new Uint8Array(64);
    paddedData.set(data);
    paddedData[data.length] = 0x80;

    // Set message length at the end (in bits)
    const dataView = new DataView(paddedData.buffer);
    dataView.setUint32(60, data.length * 8, false);

    // Convert to 32-bit words
    const dataWords = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
        dataWords[i] = dataView.getUint32(i * 4, false);
    }

    // Get expected hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const expectedHash = new Uint32Array(8);
    const hashView = new DataView(hashBuffer);
    for (let i = 0; i < 8; i++) {
        expectedHash[i] = hashView.getUint32(i * 4, false);
    }

    render(program, dataWords, expectedHash);
}
run();