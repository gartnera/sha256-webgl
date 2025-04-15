This demo implements SHA256 Proof of Work using WebGL2:

1. The input text is first hashed using SHA256
2. The hash is combined with an incrementing nonce value
3. This combined data is hashed again using SHA256
4. The shader checks if the resulting hash has the required number of leading zeros (difficulty)
5. This process repeats until a matching nonce is found

The calculation is performed on the GPU using a fragment shader, allowing for parallel processing of multiple nonce values. The difficulty parameter determines how many leading zeros are required in the final hash - higher values require more computation time.