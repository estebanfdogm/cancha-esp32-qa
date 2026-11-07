/* Shared by the browser controller and executable protocol tests. */
(function(root){
  'use strict';
  const SERVICE='b732c300-785e-4c95-a2ef-18fd274e0001';
  const COMMAND='b732c300-785e-4c95-a2ef-18fd274e0002';
  const STATUS='b732c300-785e-4c95-a2ef-18fd274e0003';
  function packet(op,seq,session,throttle=0,steering=0,power=35,kick=false){
    const data=new Uint8Array(12),v=new DataView(data.buffer);
    data[0]=0xc3;data[1]=1;data[2]=op;data[3]=Math.round(Math.max(10,Math.min(35,power)));
    v.setInt8(4,Math.round(Math.max(-100,Math.min(100,throttle))));
    v.setInt8(5,Math.round(Math.max(-100,Math.min(100,steering))));
    data[6]=kick?1:0;v.setUint16(8,seq,true);v.setUint16(10,session,true);
    return data;
  }
  function status(v){
    if(v.byteLength!==16||v.getUint8(0)!==0xc3||v.getUint8(1)!==1)throw Error('Firmware incompatible con CANCHA v1.');
    return {armed:!!(v.getUint8(2)&2),outputs:!!(v.getUint8(2)&4),timeout:!!(v.getUint8(2)&8),
      seq:v.getUint16(4,true),left:v.getInt16(6,true),right:v.getInt16(8,true),session:v.getUint16(10,true),kick:!!v.getUint8(12),error:v.getUint8(13)};
  }
  function mix(throttle,steering,power){
    function dead(v){return Math.abs(v)<=10?0:Math.sign(v)*(Math.abs(v)-10)/90;}
    const t=dead(throttle),s=dead(steering)*.67,l=t+s,r=t-s,n=Math.max(1,Math.abs(l),Math.abs(r));
    const cap=Math.min(90,Math.round(255*Math.min(35,Math.max(10,power))/100));
    return [Math.round(l/n*cap),Math.round(r/n*cap)];
  }
  const api={SERVICE,COMMAND,STATUS,packet,status,mix};
  if(typeof module!=='undefined')module.exports=api;else root.CanchaProtocol=api;
})(globalThis);
