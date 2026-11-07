const assert = require('node:assert/strict');
const test = require('node:test');
const { mix, packet, status } = require('../protocol.js');

test('codifica un comando con valores acotados y secuencia little-endian', () => {
  const bytes = packet(2, 0x1234, 0xabcd, 140, -140, 50, true);
  assert.deepEqual([...bytes], [0xc3, 1, 2, 35, 100, 156, 1, 0, 0x34, 0x12, 0xcd, 0xab]);
});

test('lee la habilitación y el PWM con signo de cada motor', () => {
  const bytes = Uint8Array.of(0xc3, 1, 3, 35, 4, 0, 246, 255, 20, 0, 7, 0, 0, 0, 0, 0);
  const result = status(new DataView(bytes.buffer));
  assert.equal(result.armed, true);
  assert.equal(result.outputs, false);
  assert.equal(result.left, -10);
  assert.equal(result.right, 20);
  assert.equal(result.session, 7);
});

test('rechaza un paquete de estado incompleto', () => {
  assert.throws(() => status(new DataView(new ArrayBuffer(15))), /Firmware incompatible/);
});

test('mantiene la zona muerta y limita la potencia al combinar avance y giro', () => {
  assert.deepEqual(mix(5, -10, 35), [0, 0]);
  assert.deepEqual(mix(100, 0, 35), [89, 89]);
  const [left, right] = mix(100, 100, 35);
  assert.equal(left, 89);
  assert.ok(right >= 0 && right < left);
});
