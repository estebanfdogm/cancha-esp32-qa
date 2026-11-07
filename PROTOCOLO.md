# CANCHA BLE v1

Android/PC son el central y cliente GATT. La C3 es el periférico y servidor. Nombre propuesto: `Cancha-C3-03`. Servicio anunciado: `b732c300-785e-4c95-a2ef-18fd274e0001`.

Comandos: `b732c300-785e-4c95-a2ef-18fd274e0002`, propiedad WRITE con respuesta. Estado: `b732c300-785e-4c95-a2ef-18fd274e0003`, READ + NOTIFY, cada 100 ms como objetivo. Los paquetes caben en el MTU BLE predeterminado. Una confirmación de escritura GATT no equivale a habilitación: esperar el bit armed del estado.

## Comando: 12 bytes

| Offset | Tamaño | Campo |
|---|---|---|
| 0 | 1 | Magic `0xC3` |
| 1 | 1 | Versión `1` |
| 2 | 1 | Opcode: `0 STOP`, `1 ARM`, `2 DRIVE` |
| 3 | 1 | Potencia máxima, entero 10…35 |
| 4 | 1 | Avance, int8 −100…100; positivo avanza |
| 5 | 1 | Giro, int8 −100…100; positivo a derecha |
| 6 | 1 | Solicitud de pateador, 0/1 |
| 7 | 1 | Reservado, cero |
| 8 | 2 | Secuencia uint16, little-endian |
| 10 | 2 | Sesión uint16, little-endian |

ARM solo admite avance, giro y pateador en cero. DRIVE no habilita. El cliente envía una sola petición ARM, espera su confirmación y nunca repite ARM automáticamente. STOP válido se admite aun con secuencia anterior; los demás comandos requieren secuencia creciente, con comparación modular de 16 bits y saltos menores de 32768.

Cada conexión obtiene una sesión nueva no nula. Leerla antes de escribir. Es una separación entre conexiones, no un mecanismo de autenticación. No se ha incorporado un flujo de vinculación con clave en esta versión.

El cliente serializa escrituras, conserva solo el estado de movimiento vigente y prioriza STOP tras la escritura en vuelo. No acumula movimientos. El firmware usa una cola acotada; desbordarla deshabilita y vacía la cola.

## Estado: 16 bytes

| Offset | Tamaño | Campo |
|---|---|---|
| 0 / 1 | 1 cada uno | Magic `0xC3`, versión `1` |
| 2 | 1 | Flags: bit 0 servidor listo; bit 1 armado; bit 2 salidas físicas configuradas; bit 3 watchdog vencido |
| 3 | 1 | Techo de potencia, 35 |
| 4 | 2 | Secuencia procesada, uint16 LE |
| 6 / 8 | 2 cada uno | Orden PWM izquierda/derecha, int16 LE |
| 10 | 2 | Sesión, uint16 LE |
| 12 | 1 | Pulso de servo activo, 0/1 |
| 13 | 1 | Error: 0 ninguno, 1 watchdog, 2 configuración PWM |
| 14 / 15 | 1 cada uno | Reservados, cero |

PWM representa la salida lógica calculada después de la rampa, no velocidad medida. Con salidas bloqueadas puede calcularse PWM para probar el enlace; ningún GPIO se activa.

## Movimiento y pateador

Zona muerta de ±10 sobre 100, reescalada al recorrido restante. Mezcla `L = avance + giro × 0,67`, `R = avance − giro × 0,67`. Normalizar ambos por el mayor valor absoluto si supera 1 y aplicar techo de PWM. A 35 % el techo es `round(255×0,35)=89`, con protección adicional de 90.

Rampa: 3 cuentas de PWM por al menos 10 ms, reduciendo a cero antes de invertir un motor. La orden neutra y STOP saltan la rampa hacia cero. El servo se activa al pasar de solicitud 0 a 1, vuelve a reposo al soltar o alcanzar 150 ms y necesita observar 0 para otro golpe.

250 ms sin DRIVE válido recibido deshabilita. Paquetes que envejecen más de 250 ms dentro de la cola se descartan y deshabilitan. Al reconectar se reinician sesión, secuencia y habilitación.
