(()=>{
  'use strict';
  const P=CanchaProtocol,$=id=>document.getElementById(id);
  let mode='idle',page='control',linked=false,armed=false,armPending=false,power=35,session=0,seq=0;
  let throttle=0,steering=0,kick=false,pointerKick=false,joyX=0,joyY=0,joyPointer=null,keys=new Set();
  let device=null,command=null,statusCharacteristic=null,busy=false,urgent=null,epoch=0,lastStatus=0,armAt=0,armSeq=0;
  let outputs=false,lastLeft=0,lastRight=0,connecting=false,connectionGeneration=0;
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  function paint(){
    $('modeLabel').textContent=mode==='real'?'BLUETOOTH REAL · '+(outputs?'SALIDAS ACTIVAS':'SALIDAS FÍSICAS BLOQUEADAS'):mode==='demo'?'DEMOSTRACIÓN ACTIVA · NINGÚN ROBOT SE MUEVE':'DEMOSTRACIÓN · SIN CONEXIÓN AL ROBOT';
    $('topStatus').lastChild.textContent=linked?(mode==='demo'?' Demo conectada':' '+(device?.name||'Cancha-C3')):' Robot desconectado';
    $('topStatus').firstElementChild.style.background=linked?'var(--lime)':'';
    $('armText').textContent=armed?'CONTROL HABILITADO':armPending?'HABILITANDO…':'EN ESPERA';
    $('armDot').style.background=armed?'var(--lime)':'';
    $('linkText').textContent=linked?(mode==='demo'?'Simulación local':outputs?'BLE conectado · recibe estado':'BLE conectado · prueba sin salidas'):'Conecta tu robot o prueba la demo';
    $('deviceMode').textContent=mode==='demo'?'MODO DEMO':mode==='real'&&!outputs?'PRUEBA SIN SALIDAS':'CONTROL MANUAL';
    $('armBtn').disabled=!linked||armPending||connecting;$('armBtn').classList.toggle('armed',armed);
    $('armBtn').innerHTML=armed?'Deshabilitar <span>■</span>':armPending?'Esperando robot…':'Habilitar motores <span>→</span>';
    $('kickBtn').disabled=!armed;$('kickBtn').classList.toggle('pressed',kick&&armed);
    $('kickNote').textContent=kick&&armed?'Pateador accionado':'Listo para tu próxima jugada';
    $('connectBtn').disabled=connecting;
    $('connectBtn').innerHTML=linked&&mode==='real'?'Desconectar <span>↗</span>':connecting?'Conectando…':'<span>ᛒ</span> Conectar robot <span>↗</span>';
    $('demoBtn').textContent=mode==='demo'?'Salir de la demo ↗':'Probar demo ↗';
    $('knob').style.transform=`translate(${steering*.7}%,${-throttle*.7}%)`;
    $('direction').textContent=!armed?'En el centro':throttle>10?'Avanzando':throttle< -10?'Retrocediendo':Math.abs(steering)>10?'Girando':'En el centro';
    const values=mode==='demo'&&armed?P.mix(throttle,steering,power):mode==='real'&&armed?[lastLeft,lastRight]:[0,0];
    $('leftValue').innerHTML=values[0]+' <span>PWM</span>';$('rightValue').innerHTML=values[1]+' <span>PWM</span>';
    $('robotModel').style.transform=armed?`translateY(${-throttle*.12}px) rotate(${steering*.3}deg)`:'none';
  }
  function inputs(){
    let x=joyX,y=joyY;
    if(keys.has('KeyW')||keys.has('ArrowUp'))y+=100;
    if(keys.has('KeyS')||keys.has('ArrowDown'))y-=100;
    if(keys.has('KeyD')||keys.has('ArrowRight'))x+=100;
    if(keys.has('KeyA')||keys.has('ArrowLeft'))x-=100;
    const norm=Math.max(100,Math.hypot(x,y));x=x/norm*100;y=y/norm*100;
    throttle=armed?Math.round(y*($('invertThrottle').checked?-1:1)):0;
    steering=armed?Math.round(x*($('invertSteering').checked?-1:1)):0;
    kick=armed&&(pointerKick||keys.has('Space'));paint();
  }
  function clearInputs(){keys.clear();joyX=joyY=0;pointerKick=false;throttle=steering=0;kick=false;joyPointer=null;}
  function stop(reason='Detenido. Pulsa Habilitar para volver a conducir.'){
    epoch++;armed=false;armPending=false;clearInputs();lastLeft=lastRight=0;
    if(mode==='real'&&linked){urgent={op:0,epoch};void transmit();}paint();message(reason);
  }
  function teardown(){
    connectionGeneration++;connecting=false;epoch++;urgent=null;linked=false;armed=false;armPending=false;clearInputs();
    statusCharacteristic?.removeEventListener('characteristicvaluechanged',gotStatus);
    command=null;statusCharacteristic=null;session=0;lastLeft=lastRight=0;outputs=false;
    if(device?.gatt?.connected)device.gatt.disconnect();device=null;paint();
  }
  function loseLink(reason){teardown();mode='idle';paint();message(reason,true);}
  function gotStatus(event){
    if(mode!=='real'||!linked)return;
    try{acceptStatus(event.target.value);}catch(e){loseLink(e.message);}
  }
  function acceptStatus(value){
    const s=P.status(value);if(s.session!==session)throw Error('Cambió la sesión del robot. Vuelve a conectar.');
    lastStatus=performance.now();outputs=s.outputs;lastLeft=s.left;lastRight=s.right;
    if(armPending){
      const ack=armSeq!==null&&(s.seq-armSeq+65536)%65536<32768;
      if(ack&&s.armed){armPending=false;armed=true;message(outputs?'Control habilitado.':'Prueba BLE: firmware conectado, salidas físicas bloqueadas.');}
      else if(ack&&!s.armed){stop('El robot rechazó la habilitación. Revisa el firmware y centra los controles.');}
    }else if(armed&&!s.armed){stop(s.timeout?'El robot se detuvo por falta de órdenes. Habilita de nuevo.':'El robot deshabilitó el movimiento.');}
    paint();
  }
  async function connect(){
    if(linked&&mode==='real'){stop('Desconectando…');teardown();mode='idle';paint();message('Robot desconectado.');return;}
    if(!navigator.bluetooth){message('Abre el control en Chrome o Edge con Bluetooth disponible. Puedes usar la demo aquí.',true);return;}
    if(!window.isSecureContext){message('Bluetooth requiere HTTPS o localhost. Ejecuta python serve.py y abre la dirección indicada.',true);return;}
    teardown();mode='real';connecting=true;paint();
    const generation=connectionGeneration;
    try{
      const chosen=await navigator.bluetooth.requestDevice({filters:[{services:[P.SERVICE]}]});
      if(generation!==connectionGeneration)return;
      device=chosen;device.addEventListener('gattserverdisconnected',()=>{if(device===chosen)loseLink('Enlace perdido. El robot requiere habilitar de nuevo.');});
      const gatt=await device.gatt.connect();if(generation!==connectionGeneration){gatt.disconnect();return;}
      const service=await gatt.getPrimaryService(P.SERVICE);
      const tx=await service.getCharacteristic(P.COMMAND),rx=await service.getCharacteristic(P.STATUS);
      await rx.startNotifications();const initial=P.status(await rx.readValue());
      if(generation!==connectionGeneration){gatt.disconnect();return;}
      command=tx;statusCharacteristic=rx;session=initial.session;seq=initial.seq;outputs=initial.outputs;
      lastStatus=performance.now();linked=true;connecting=false;
      rx.addEventListener('characteristicvaluechanged',gotStatus);stop(outputs?'Robot conectado. Pulsa Habilitar con los controles centrados.':'Robot conectado para pruebas. Las salidas físicas están bloqueadas en el firmware.');
    }catch(e){if(generation!==connectionGeneration)return;teardown();mode='idle';paint();message(e.name==='NotFoundError'?'Conexión cancelada.':`No se pudo conectar: ${e.message}`,true);}
  }
  async function transmit(){
    if(busy||!linked||mode!=='real'||!command)return;
    busy=true;const current=epoch,tx=command,cmd=urgent;urgent=null;
    const op=cmd?.op??((armed||armPending)?2:0),packetSeq=(++seq)&65535;
    if(op===1)armSeq=packetSeq;
    const data=P.packet(op,packetSeq,session,op===2?throttle:0,op===2?steering:0,power,op===2&&kick);
    try{await tx.writeValueWithResponse(data);}catch(e){if(tx===command)loseLink('No se pudo enviar la orden. Vuelve a conectar.');}
    finally{busy=false;if(current!==epoch&&urgent&&linked)void transmit();}
  }
  function setPage(next){stop('Control detenido al cambiar de pantalla.');page=next;document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!==next);document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===next));$('breadcrumb').textContent={control:'MANDO',team:'MI EQUIPO',settings:'AJUSTES'}[next];}
  document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>setPage(el.dataset.page)));
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();setPage('team');});
  $('teamControl').addEventListener('click',()=>setPage('control'));
  $('connectBtn').addEventListener('click',connect);
  $('demoBtn').addEventListener('click',()=>{const leave=mode==='demo';stop();teardown();mode=leave?'idle':'demo';linked=!leave;paint();message(leave?'Demo cerrada.':'Demo activa: habilita el control y prueba joystick, teclado y pateador.');});
  $('armBtn').addEventListener('click',()=>{
    if(armed||armPending){stop();return;}
    if(!linked||joyX||joyY||pointerKick||keys.size){message('Suelta los controles antes de habilitar.',true);return;}
    if(mode==='demo'){armed=true;paint();message('Demo habilitada. Ningún robot está conectado.');return;}
    armPending=true;armSeq=null;armAt=performance.now();urgent={op:1,epoch};paint();void transmit();
  });
  $('stopBtn').addEventListener('click',()=>stop());
  $('power').addEventListener('input',e=>{power=Number(e.target.value);$('powerValue').textContent=power+' %';paint();});
  ['invertSteering','invertThrottle'].forEach(id=>$(id).addEventListener('change',()=>stop('Ajuste guardado. Habilita de nuevo para probar.')));
  const joy=$('joystick');
  function moveJoy(e){if(joyPointer!==e.pointerId||!armed)return;const r=joy.getBoundingClientRect(),range=r.width*.34;let x=(e.clientX-r.left-r.width/2)/range*100,y=-(e.clientY-r.top-r.height/2)/range*100;const n=Math.max(100,Math.hypot(x,y));joyX=x/n*100;joyY=y/n*100;inputs();}
  joy.addEventListener('pointerdown',e=>{if(!armed||joyPointer!==null)return;joyPointer=e.pointerId;joy.setPointerCapture(e.pointerId);moveJoy(e);});
  joy.addEventListener('pointermove',moveJoy);
  function releaseJoy(e){if(joyPointer!==e.pointerId)return;joyPointer=null;joyX=joyY=0;inputs();}
  joy.addEventListener('pointerup',releaseJoy);joy.addEventListener('pointercancel',()=>stop('Gesto interrumpido. Control detenido.'));joy.addEventListener('lostpointercapture',releaseJoy);
  const kickButton=$('kickBtn');
  kickButton.addEventListener('pointerdown',e=>{if(!armed||pointerKick)return;pointerKick=true;kickButton.setPointerCapture(e.pointerId);inputs();});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>kickButton.addEventListener(type,()=>{pointerKick=false;inputs();}));
  // Keyboard activation on the native kick button is also available with Enter.
  kickButton.addEventListener('keydown',e=>{if(e.code==='Enter'&&armed){e.preventDefault();pointerKick=true;inputs();}});
  kickButton.addEventListener('keyup',e=>{if(e.code==='Enter'){pointerKick=false;inputs();}});
  const movementKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'];
  document.addEventListener('keydown',e=>{
    if(e.code==='Escape'){e.preventDefault();stop();return;}
    if(page!=='control'||!movementKeys.includes(e.code)||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable)return;
    if(e.code==='Space'&&e.target.closest('button')&&e.target!==kickButton)return;
    e.preventDefault();if(armed){keys.add(e.code);inputs();}
  });
  document.addEventListener('keyup',e=>{if(keys.delete(e.code))inputs();});
  window.addEventListener('blur',()=>stop('Control detenido al salir de la ventana.'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Control detenido al ocultar la aplicación.');});
  window.addEventListener('pagehide',()=>{stop();if(device?.gatt?.connected)device.gatt.disconnect();});
  setInterval(()=>{
    if(mode!=='real'||!linked)return;
    if(performance.now()-lastStatus>750){loseLink('El robot dejó de confirmar su estado. Vuelve a conectar.');return;}
    if(armPending&&performance.now()-armAt>1000){stop('No llegó confirmación de habilitación.');return;}
    void transmit();
  },50);
  paint();
})();
