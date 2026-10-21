const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'form.js'), 'utf8');
function ready(rows) {
  const card = {classList: {add() {}, remove() {}}, querySelector() { return null; }, scrollIntoView() {}};
  const list = {
    querySelectorAll() { return rows.map(values => ({querySelectorAll() { return values.map(value => ({value})); }})); },
    closest() { return card; }
  };
  const document = {
    getElementById(id) { return id === 'lim-list' ? list : id === 'name' ? {value: 'Test'} : null; },
    querySelector(selector) {
      if (selector === 'main.wrap') return null;
      if (selector === 'input[name="nper"]:checked') return {value: '3'};
      if (selector.includes('input[type="radio"]')) return {};
      return card;
    },
    querySelectorAll(selector) { return selector.includes('name="day"') ? [{}, {}, {}] : []; }
  };
  const context = {document, window: {}};
  vm.runInNewContext(source, context);
  return context.window.memtofitReady();
}

assert.equal(ready([['', '', '']]), true, 'unused row is optional');
for (const level of ['', 'Not sure', 'Unknown', '0', '5 Severe']) {
  assert.equal(ready([['Wrist pain', 'Left', level]]), false, 'invalid injury rating: ' + level);
}
for (const level of ['1 Mild', '2 Mild–Moderate', '3 Moderate', '4 Severe']) {
  assert.equal(ready([['Wrist pain', 'Left', level]]), true, 'submit reported rating; generator owns L4 stop');
}
assert.equal(ready([['Hip stiffness', 'Right', '1 Mild'], ['Back pain', '', '']]), false, 'additional row needs rating');
assert.equal(ready([['Hip stiffness', 'Right', '1 Mild'], ['Back pain', '', '2 Mild–Moderate']]), true);
assert.equal(ready([['', 'Left', '1 Mild']]), false, 'half-filled row needs injury text');
const html = fs.readFileSync(path.join(__dirname, 'questionnaire.html'), 'utf8');
const limitations = html.slice(html.indexOf('id="lim-list"'), html.indexOf('</template>'));
assert.equal((limitations.match(/<option>Not sure<\/option>/g) || []).length, 0);
assert.equal((limitations.match(/Level \(required for each injury or limitation\)/g) || []).length, 2);
console.log('Questionnaire injury rating checks passed');
