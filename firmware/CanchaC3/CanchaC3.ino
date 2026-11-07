/* CANCHA v1 — ESP32-C3 + TB6612FNG. Arduino-ESP32 3.3.12.
 * Default is a BLE bench test: no GPIO output until OUTPUTS_CONFIRMED=true.
 * Proposed pinout and servo travel MUST be checked against the actual robot.
 */
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <esp_system.h>
#include <atomic>

#if !defined(CONFIG_IDF_TARGET_ESP32C3)
#error "Select ESP32C3 Dev Module. Do not upload this pinout to the other robots."
#endif

constexpr bool OUTPUTS_CONFIRMED = false;
constexpr uint8_t PWMA=0, PWMB=1, AIN1=3, AIN2=4, BIN1=5, BIN2=6, STBY=7, SERVO=10;
constexpr bool INVERT_LEFT=false, INVERT_RIGHT=false;
// Conservative EXAMPLE travel, not calibrated for your mechanism.
constexpr uint16_t SERVO_REST_US=1100, SERVO_KICK_US=1300;
constexpr uint32_t KICK_MAX_MS=150, LINK_TIMEOUT_MS=250;
constexpr char SERVICE[]="b732c300-785e-4c95-a2ef-18fd274e0001";
constexpr char COMMAND[]="b732c300-785e-4c95-a2ef-18fd274e0002";
constexpr char STATUS_UUID[]="b732c300-785e-4c95-a2ef-18fd274e0003";
struct Packet { uint8_t b[12]; uint32_t receivedAt; };
QueueHandle_t commands;
std::atomic<bool> connected{false}, resetSession{false}, forceStop{false}, restartAdvertising{false};
std::atomic<uint16_t> session{0};
BLECharacteristic *statusChar=nullptr;
bool armed=false, timedOut=false, haveSeq=false, kickHeld=false, kickActive=false, kickReleased=true, pwmReady=false;
uint16_t lastSeq=0;
uint32_t lastCommand=0, lastRamp=0, lastNotify=0, kickStart=0;
int targetLeft=0,targetRight=0,leftPWM=0,rightPWM=0;
uint8_t errorCode=0;

uint16_t get16(const uint8_t *p){ return uint16_t(p[0]) | (uint16_t(p[1])<<8); }
void put16(uint8_t *p,uint16_t v){ p[0]=v&255;p[1]=v>>8; }
void servoPulse(uint16_t us){ if(OUTPUTS_CONFIRMED&&pwmReady)ledcWrite(SERVO,uint32_t(us)*65535/20000); }
void stopAll(){
  armed=false;targetLeft=targetRight=leftPWM=rightPWM=0;kickHeld=false;kickActive=false;kickReleased=true;
  if(OUTPUTS_CONFIRMED){digitalWrite(STBY,LOW);if(pwmReady){ledcWrite(PWMA,0);ledcWrite(PWMB,0);}}
  servoPulse(SERVO_REST_US);
}
void motor(uint8_t pwm,uint8_t in1,uint8_t in2,int value,bool invert){
  if(!OUTPUTS_CONFIRMED||!pwmReady)return;
  if(invert)value=-value;
  ledcWrite(pwm,0);digitalWrite(in1,value>0?HIGH:LOW);digitalWrite(in2,value<0?HIGH:LOW);ledcWrite(pwm,abs(value));
}
void outputMotors(){
  if(!OUTPUTS_CONFIRMED||!pwmReady)return;
  if(!armed){digitalWrite(STBY,LOW);return;}
  motor(PWMA,AIN1,AIN2,leftPWM,INVERT_LEFT);motor(PWMB,BIN1,BIN2,rightPWM,INVERT_RIGHT);
  digitalWrite(STBY,(leftPWM||rightPWM)?HIGH:LOW);
}
float dead(int v){return abs(v)<=10?0:(v>0?1:-1)*(abs(v)-10)/90.0f;}
void setTargets(int throttle,int steering,int power){
  float t=dead(throttle),s=dead(steering)*.67f,l=t+s,r=t-s,n=max(1.0f,max(fabsf(l),fabsf(r)));
  int cap=min(90,int(lroundf(255*min(35,max(10,power))/100.0f)));
  targetLeft=lroundf(l/n*cap);targetRight=lroundf(r/n*cap);
  // Neutral controls take the command to zero immediately, regardless of ramp.
  if(!targetLeft&&!targetRight){leftPWM=rightPWM=0;outputMotors();}
}
int ramp(int value,int target){
  if(value&&target&&((value<0)!=(target<0)))target=0;
  return value<target?min(value+3,target):max(value-3,target);
}
void process(const Packet &packet){
  const uint8_t *b=packet.b;
  if(millis()-packet.receivedAt>LINK_TIMEOUT_MS){stopAll();return;}
  if(b[0]!=0xc3||b[1]!=1||b[2]>2||b[3]<10||b[3]>35||b[6]>1||b[7]||get16(b+10)!=session.load())return;
  int t=int8_t(b[4]),s=int8_t(b[5]);if(abs(t)>100||abs(s)>100)return;
  const uint16_t sequence=get16(b+8);
  const bool newer=!haveSeq||(int16_t(sequence-lastSeq)>0);
  if(b[2]==0){stopAll();if(newer){lastSeq=sequence;haveSeq=true;}return;}
  if(!newer||!connected.load())return;
  haveSeq=true;lastSeq=sequence;
  if(b[2]==1){
    if(t||s||b[6]||(OUTPUTS_CONFIRMED&&!pwmReady)){stopAll();return;}
    stopAll();armed=true;timedOut=false;errorCode=0;lastCommand=packet.receivedAt;return;
  }
  if(!armed)return; // DRIVE cannot arm after watchdog or reconnection.
  lastCommand=packet.receivedAt;setTargets(t,s,b[3]);kickHeld=b[6];
}
class ServerCallbacks:public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    session.store(uint16_t(esp_random()%65535+1));resetSession.store(true);connected.store(true);
  }
  void onDisconnect(BLEServer*) override {
    connected.store(false);forceStop.store(true);restartAdvertising.store(true);
  }
};
class CommandCallbacks:public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    auto value=c->getValue();
    if(value.length()!=12||!connected.load())return;
    Packet p;memcpy(p.b,value.c_str(),12);p.receivedAt=millis();
    // Callbacks never manipulate GPIO. Overflow latches a stop in the loop.
    if(xQueueSend(commands,&p,0)!=pdTRUE)forceStop.store(true);
  }
};
void publish(){
  uint8_t s[16]={0xc3,1,0,35};
  s[2]=1|(armed?2:0)|((OUTPUTS_CONFIRMED&&pwmReady)?4:0)|(timedOut?8:0);
  put16(s+4,lastSeq);put16(s+6,uint16_t(int16_t(leftPWM)));put16(s+8,uint16_t(int16_t(rightPWM)));
  put16(s+10,session.load());s[12]=kickActive;s[13]=errorCode;
  statusChar->setValue(s,sizeof(s));if(connected.load())statusChar->notify();
}
void setup(){
  Serial.begin(115200);
  if(OUTPUTS_CONFIRMED){
    pinMode(STBY,OUTPUT);digitalWrite(STBY,LOW);
    for(uint8_t pin:{AIN1,AIN2,BIN1,BIN2}){pinMode(pin,OUTPUT);digitalWrite(pin,LOW);}
    // Motor channels 0/1 share timer 0. Servo channel 2 uses timer 1.
    const bool a=ledcAttachChannel(PWMA,20000,8,0),b=ledcAttachChannel(PWMB,20000,8,1),c=ledcAttachChannel(SERVO,50,16,2);
    pwmReady=a&&b&&c;if(!pwmReady)errorCode=2;
  }
  stopAll();commands=xQueueCreate(8,sizeof(Packet));
  if(!commands){Serial.println("Queue allocation failed");while(true)delay(1000);}
  BLEDevice::init("Cancha-C3-03");
  BLEServer *server=BLEDevice::createServer();server->setCallbacks(new ServerCallbacks());
  BLEService *service=server->createService(SERVICE);
  BLECharacteristic *command=service->createCharacteristic(COMMAND,BLECharacteristic::PROPERTY_WRITE);
  command->setCallbacks(new CommandCallbacks());
  statusChar=service->createCharacteristic(STATUS_UUID,BLECharacteristic::PROPERTY_READ|BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());publish();service->start();
  BLEAdvertising *advertising=BLEDevice::getAdvertising();advertising->addServiceUUID(SERVICE);advertising->setScanResponse(true);advertising->start();
  Serial.println(OUTPUTS_CONFIRMED?"CANCHA: physical outputs enabled":"CANCHA: BLE bench test, physical outputs BLOCKED");
}
void loop(){
  if(resetSession.exchange(false)){stopAll();haveSeq=false;lastSeq=0;timedOut=false;xQueueReset(commands);publish();}
  if(forceStop.exchange(false)){stopAll();xQueueReset(commands);}
  if(restartAdvertising.exchange(false))BLEDevice::startAdvertising();
  if(armed&&(!connected.load()||millis()-lastCommand>LINK_TIMEOUT_MS)){stopAll();timedOut=true;errorCode=1;}
  Packet p;
  // Bounded processing leaves time for the independent watchdog and PWM loop.
  for(int i=0;i<8&&xQueueReceive(commands,&p,0)==pdTRUE;i++)process(p);
  const uint32_t now=millis();
  if(armed&&(!connected.load()||now-lastCommand>LINK_TIMEOUT_MS)){stopAll();timedOut=true;errorCode=1;}
  if(armed){
    if(now-lastRamp>=10){lastRamp=now;leftPWM=ramp(leftPWM,targetLeft);rightPWM=ramp(rightPWM,targetRight);outputMotors();}
    if(!kickHeld){kickReleased=true;kickActive=false;servoPulse(SERVO_REST_US);}
    else if(kickReleased){kickReleased=false;kickActive=true;kickStart=now;servoPulse(SERVO_KICK_US);}
    if(kickActive&&now-kickStart>=KICK_MAX_MS){kickActive=false;servoPulse(SERVO_REST_US);}
  }
  if(now-lastNotify>=100){lastNotify=now;publish();}
  delay(2);
}
