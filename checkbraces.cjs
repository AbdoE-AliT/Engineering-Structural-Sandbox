// parsecheck.cjs
const fs = require('fs');
const acorn = require('acorn');   // <-- see Step 2
const src = fs.readFileSync('src/app.js', 'utf8');
try {
  acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  console.log('Parsed OK — no syntax error.');
} catch (e) {
  console.log('ERROR:', e.message);
  console.log('Position:', e.pos);
  // Find line/col
  const upto = src.slice(0, e.pos);
  const line = upto.split('\n').length;
  const col = e.pos - upto.lastIndexOf('\n');
  console.log('At line', line, 'col', col);
  // Show surrounding context
  const lines = src.split('\n');
  const start = Math.max(0, line - 6);
  const end = Math.min(lines.length, line + 3);
  for (let i = start; i < end; i++) {
    const marker = (i === line - 1) ? ' >>> ' : '     ';
    console.log(marker + (i + 1) + ': ' + lines[i]);
  }
}