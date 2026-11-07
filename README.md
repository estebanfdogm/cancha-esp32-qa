# CANCHA

Prototipo web para controlar un robot de fútbol con ESP32-C3 por Bluetooth Low Energy. La interfaz se puede probar con teclado o controles táctiles en modo demo.

## Probar sin robot

Con Python 3 instalado, abre una terminal en la carpeta del proyecto.

```powershell
python serve.py
```

En Chrome o Edge, abre `http://localhost:8765` si el navegador no se abre automáticamente. Pulsa **Probar demo** y **Habilitar motores**. En ese modo, los controles cambian el estado que se muestra en la página.

| Acción | Qué deberías ver |
|---|---|
| Mantener **W** o **↑** | Las dos órdenes de avance cambian en el mismo sentido. |
| Soltar la tecla | La orden de movimiento vuelve a cero. |
| Pulsar **Esc** o **Parar** | El control se deshabilita. Para continuar, debes habilitarlo otra vez. |
| Cambiar de pestaña mientras está habilitado | Al volver, el control permanece deshabilitado. |

## Pruebas del protocolo

Con Node.js 20 o superior, ejecuta desde la raíz del proyecto.

```powershell
node --test tests/protocol.test.cjs
```

Las pruebas comprueban el formato de los paquetes, el rechazo de un estado incompatible y el límite de potencia aplicado al mezclar avance y giro. El [protocolo BLE](PROTOCOLO.md) detalla los campos y estados.

## Firmware

El sketch está en `firmware/CanchaC3/`. La configuración incluida mantiene deshabilitadas las salidas físicas. La demo es web y la conexión, el cableado y el comportamiento del robot quedan pendientes de verificar en placa.
