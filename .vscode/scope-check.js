const fs = require('fs');
const s = fs.readFileSync('app.js', 'utf8');
let i = 0;
let line = 1;
let depth = 0;
let mode = 'code';
while (i < s.length) {
  const c = s[i];
  const n = s[i + 1];
  if (c === '\n') {
    line += 1;
    i += 1;
    continue;
  }
  if (mode === 'line') {
    i += 1;
    continue;
  }
  if (mode === 'block') {
    if (c === '*' && n === '/') {
      mode = 'code';
      i += 2;
    } else i += 1;
    continue;
  }
  if (mode === 's' || mode === 'd' || mode === 't') {
    if (c === '\\') {
      i += 2;
      continue;
    }
    if ((mode === 's' && c === "'") || (mode === 'd' && c === '"') || (mode === 't' && c === '`')) mode = 'code';
    i += 1;
    continue;
  }
  if (c === '/' && n === '/') {
    mode = 'line';
    i += 2;
    continue;
  }
  if (c === '/' && n === '*') {
    mode = 'block';
    i += 2;
    continue;
  }
  if (c === "'") {
    mode = 's';
    i += 1;
    continue;
  }
  if (c === '"') {
    mode = 'd';
    i += 1;
    continue;
  }
  if (c === '`') {
    mode = 't';
    i += 1;
    continue;
  }
  if (c === '{') depth += 1;
  if (c === '}') depth -= 1;
  if (s.startsWith('function renderSharedPage', i) || s.startsWith('function navigateTo', i) || s.startsWith('function renderAllPages', i)) {
    console.log(s.slice(i, i + 26), 'line', line, 'braceDepth', depth);
  }
  i += 1;
}
console.log('final depth', depth);
