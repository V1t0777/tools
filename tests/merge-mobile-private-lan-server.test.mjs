import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../scripts/yunyu-local-mobile-server.py',import.meta.url),'utf8');
const builder=readFileSync(new URL('../scripts/build-yunyu-private-review.sh',import.meta.url),'utf8');
test('mobile review LAN server has no public-interface binding or anonymous LAN access',()=>{
  assert.match(source,/LAN_RANGES/);
  assert.match(source,/self\.client_address\[0\] == options\.phone_ip/);
  assert.match(source,/HTTPServer\(\(options\.bind_ip, options\.port\)/);
  assert.match(source,/DIRECTORY_LISTING_DISABLED/);
  assert.match(source,/CLOUD_AUTH_REQUIRES_PRIVATE_HTTPS/);
  assert.match(source,/route.startswith\("\/merge\/cloud"\)/);
  assert.match(source,/route.startswith\("\/shared\/toolbox-auth"\)/);
  assert.doesNotMatch(source,/HTTPServer\(\(["']0\.0\.0\.0["']/);
  assert.match(builder,/PRIVATE-IPHONE-LAN-SERVER\.py/);
  assert.match(builder,/START-IPHONE-PRIVATE-LAN\.bat/);
});
test('LAN review server refuses public / wildcard / invalid IPv4 before starting a listener',()=>{
  const python=spawnSync('python3',['--version'],{encoding:'utf8'});
  if(python.status!==0)return;
  const script=new URL('../scripts/yunyu-local-mobile-server.py',import.meta.url).pathname;
  for(const value of ['0.0.0.0','8.8.8.8','127.0.0.1','::1','not-an-ip']){
    const proc=spawnSync('python3',[script,'--bind-ip',value,
      '--phone-ip','192.168.1.11'],{encoding:'utf8',timeout:5000});
    assert.notEqual(proc.status,0,'must not bind to '+value);
    assert.match(proc.stderr,/局域网|IPv4/);
  }
});
