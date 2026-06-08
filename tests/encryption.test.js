/**
 * Encryption module tests
 * Run with: npm test
 */

// Note: WebCrypto is available in jsdom (Node 18+) via @jest-environment jsdom
// but subtle crypto may need the `jest-environment-jsdom` package

describe('Encryption Module', () => {
  let generateKey, encrypt, decrypt;

  beforeAll(async () => {
    // Mock chrome.storage.local for getOrCreateDeviceUID
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, cb) => cb({ _deviceUID: 'test-device-uid-123' })),
          set: jest.fn((data, cb) => cb?.()),
        },
      },
      runtime: { id: 'test-ext-id' },
    };

    // Dynamic import after mocking chrome
    const mod = await import('../src/security/encryption.js');
    generateKey = mod.generateKey;
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  test('generateKey returns a CryptoKey', async () => {
    const key = await generateKey('test-uid-123');
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  test('encrypt returns a non-empty base64 string', async () => {
    const key = await generateKey('test-uid-123');
    const data = { name: 'John Doe', email: 'john@example.com' };
    const ciphertext = await encrypt(data, key);

    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(0);
    // Verify it's valid base64
    expect(() => atob(ciphertext)).not.toThrow();
  });

  test('decrypt recovers original data', async () => {
    const key = await generateKey('test-uid-123');
    const original = { name: 'John Doe', email: 'john@example.com', phone: '+91 9876543210' };

    const ciphertext = await encrypt(original, key);
    const decrypted = await decrypt(ciphertext, key);

    expect(decrypted).toEqual(original);
  });

  test('different UIDs produce different ciphertexts', async () => {
    const key1 = await generateKey('uid-aaa');
    const key2 = await generateKey('uid-bbb');
    const data = { secret: 'test' };

    const c1 = await encrypt(data, key1);
    const c2 = await encrypt(data, key2);

    expect(c1).not.toBe(c2);
  });

  test('decrypt fails with wrong key', async () => {
    const key1 = await generateKey('uid-correct');
    const key2 = await generateKey('uid-wrong');
    const data = { secret: 'test' };

    const ciphertext = await encrypt(data, key1);
    await expect(decrypt(ciphertext, key2)).rejects.toThrow();
  });

  test('encrypt with same key produces different ciphertexts (random IV)', async () => {
    const key = await generateKey('test-uid');
    const data = { value: 42 };

    const c1 = await encrypt(data, key);
    const c2 = await encrypt(data, key);

    // IVs are random, so ciphertexts should differ
    expect(c1).not.toBe(c2);
  });
});

