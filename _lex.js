const fs = require('fs');
const src = fs.readFileSync('src/app.js', 'utf8');
// minimal tokenizer: track strings, templates, comments, regex
let i = 0, line = 1, depth = 0;
const stack = []; // for template ${} nesting: 'template' or 'brace'
let state = 'code';
let prevSig = ''; // previous significant char in code
const depths = [];
function advance(c){ if(c==='\n') line++; }
while (i < src.length) {
  const c = src[i], n = src[i+1];
  if (state === 'code') {
    if (c === '/' && n === '/') { state='line'; i+=2; continue; }
    if (c === '/' && n === '*') { state='block'; i+=2; continue; }
    if (c === "'") { state='sq'; i++; continue; }
    if (c === '"') { state='dq'; i++; continue; }
    if (c === '`') { state='tpl'; i++; continue; }
    if (c === '/' && /[(,=:[!&|?{};\n]/.test(prevSig)) { state='regex'; i++; continue; }
    if (c === '{') { depth++; stack.push('brace'); prevSig='{'; i++; continue; }
    if (c === '}') {
      depth--;
      if (stack.length && stack[stack.length-1]==='tplExpr') { stack.pop(); state='tpl'; }
      else if (stack.length && stack[stack.length-1]==='brace') stack.pop();
      prevSig='}'; i++; continue;
    }
    if (!/\s/.test(c)) prevSig=c;
    i++; continue;
  }
  if (state === 'line') { if (c==='\n'){state='code';line++;} i++; continue; }
  if (state === 'block') { if (c==='*'&&n==='/'){state='code';i+=2;continue;} advance(c); i++; continue; }
  if (state === 'sq') { if (c==='\\'){i+=2;continue;} if (c==="'"){state='code';prevSig="'";} advance(c); i++; continue; }
  if (state === 'dq') { if (c==='\\'){i+=2;continue;} if (c==='"'){state='code';prevSig='"';} advance(c); i++; continue; }
  if (state === 'regex') { if (c==='\\'){i+=2;continue;} if (c==='['){ /* char class */ } if (c==='/'){state='code';prevSig='/';} if (c==='\n'){state='code';} advance(c); i++; continue; }
  if (state === 'tpl') {
    if (c==='\\'){i+=2;continue;}
    if (c==='`'){state='code';prevSig='`';i++;continue;}
    if (c==='$'&&n==='{'){stack.push('tplExpr');state='code';depth++;prevSig='{';i+=2;continue;}
    advance(c); i++; continue;
  }
}
console.log('final depth', depth, 'stack', stack.length, 'state', state, 'line', line);
