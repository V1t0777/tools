import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findEmailLiterals} from '../scripts/privacy-email.mjs';

test('privacy scanner detects realistic account literals without leaking private values',()=>{
 const sample='insert into accounts values (\'doctor@hospital.example\', \'user.name+tag@sub.example.invalid\');';
 assert.deepEqual(findEmailLiterals(sample),['doctor@hospital.example','user.name+tag@sub.example.invalid']);
});
test('privacy scanner ignores incomplete account strings and nonemail SQL',()=>{
 assert.deepEqual(findEmailLiterals('abc@local xx@domain.1x test@localhost a@b.c 12@abc.'),[]);
});
test('privacy scanner handles long hostile strings without nested regular expression backtracking',()=>{
 const input='a'.repeat(200_000)+'@'+ 'subdomain.'.repeat(1_000)+'example.com';
 const emails=findEmailLiterals(input);
 assert.equal(emails.length,1);
 assert.equal(emails[0].length,input.length);
 assert.deepEqual(findEmailLiterals('a'.repeat(200_000)),[]);
});
test('privacy scan allows example placeholders without permitting genuine addresses',()=>{
 const found=findEmailLiterals('test@example.invalid admin@hospital.example test@example.com');
 const actionable=found.filter(address=>!/@(?:example\.(?:invalid|com|org|net)|localhost)$/i.test(address));
 assert.deepEqual(actionable,['admin@hospital.example']);
});
