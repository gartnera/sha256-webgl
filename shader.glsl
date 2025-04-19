#version 300 es
precision highp float;
precision highp int;

uniform uint data[16];
uniform uint difficulty;
uniform int baseNonce;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out int nonce;
layout(location = 2) out uint hash0;

uint k[64] = uint[](
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);

uint rightRotate(uint x, uint n) {
    return (x >> n) | (x << (32u - n));
}

void computeHash(uint messageData[16], out uint result[8], int messageNonce) {
    uint w[64];
    uint a = 0x6a09e667u;
    uint b = 0xbb67ae85u;
    uint c = 0x3c6ef372u;
    uint d = 0xa54ff53au;
    uint e = 0x510e527fu;
    uint f = 0x9b05688cu;
    uint g = 0x1f83d9abu;
    uint h = 0x5be0cd19u;

    for(int i = 0; i < 16; i++) {
        w[i] = messageData[i];
    }

    w[8] = uint(messageNonce);

    for(int i = 16; i < 64; i++) {
        uint s0 = rightRotate(w[i-15], 7u) ^ rightRotate(w[i-15], 18u) ^ (w[i-15] >> 3u);
        uint s1 = rightRotate(w[i-2], 17u) ^ rightRotate(w[i-2], 19u) ^ (w[i-2] >> 10u);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }

    for(int i = 0; i < 64; i++) {
        uint S1 = rightRotate(e, 6u) ^ rightRotate(e, 11u) ^ rightRotate(e, 25u);
        uint ch = (e & f) ^ (~e & g);
        uint temp1 = h + S1 + ch + k[i] + w[i];
        uint S0 = rightRotate(a, 2u) ^ rightRotate(a, 13u) ^ rightRotate(a, 22u);
        uint maj = (a & b) ^ (a & c) ^ (b & c);
        uint temp2 = S0 + maj;

        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    result[0] = a + 0x6a09e667u;
    result[1] = b + 0xbb67ae85u;
    result[2] = c + 0x3c6ef372u;
    result[3] = d + 0xa54ff53au;
    result[4] = e + 0x510e527fu;
    result[5] = f + 0x9b05688cu;
    result[6] = g + 0x1f83d9abu;
    result[7] = h + 0x5be0cd19u;
}

void main() {
    // Get the pixel coordinates
    ivec2 pixelCoord = ivec2(gl_FragCoord.xy);
    
    // Calculate unique nonce range for this pixel
    // Each pixel will process 10 nonces
    int noncesPerPixel = 10;
    int pixelOffset = (pixelCoord.y * int(gl_FragCoord.w) + pixelCoord.x) * noncesPerPixel;
    int startNonce = baseNonce + pixelOffset;
    int endNonce = startNonce + noncesPerPixel;

    uint hash[8];
    nonce = -1;
    bool matches = false;

    // Process this pixel's range of nonces
    for (int i = startNonce; i < endNonce; i++) {
        computeHash(data, hash, i);

        bool leadingZeros = true;
        for (uint d = 0u; d < difficulty; ++d) {
            uint shiftAmount = 28u - d * 4u;
            uint nibble = (hash[0] >> shiftAmount) & 0xFu;
            if (nibble != 0u) {
                leadingZeros = false;
                break;
            }
        }

        if (leadingZeros) {
            nonce = i;
            matches = true;
            hash0 = hash[0];
            break;
        }
    }

    fragColor = matches ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
}