const fs = require('fs');

let acorn;
try {
  acorn = require('acorn');
} catch {
  console.log('acorn not installed — run: npm install --save-dev acorn');
  process.exit(1);
}

const src = fs.readFileSync('src/app.js', 'utf8');
try {
  acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  console.log('Parsed OK — no syntax error.');
} catch (e) {
  console.log('ERROR:', e.message);
  const line = e.loc ? e.loc.line : (src.slice(0, e.pos).split('\n').length);
  const col  = e.loc ? e.loc.column : 0;
  console.log('At line', line, 'col', col);
  const lines = src.split('\n');
  const start = Math.max(0, line - 8);
  const end   = Math.min(lines.length, line + 3);
  for (let i = start; i < end; i++) {
    const marker = (i === line - 1) ? ' >>> ' : '     ';
    console.log(marker + (i + 1) + ': ' + lines[i]);
  }
}