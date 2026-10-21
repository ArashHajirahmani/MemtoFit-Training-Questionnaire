const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const entry = read('index.html').match(/<script>\s*([\s\S]*?)<\/script>/)[1];

async function landing(plan, today) {
  const elements = {};
  const document = {getElementById(id) {
    if (!elements[id]) {
      const classes = new Set(id === 'program-link' ? ['is-disabled'] : []);
      elements[id] = {hidden: true, textContent: '', addEventListener() {}, setAttribute() {}, removeAttribute() {},
        classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x)}};
    }
    return elements[id];
  }};
  const row = {answers: '**Name:** Test', plan};
  let destination = '';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [today.getTime()])); } }
  vm.runInNewContext(entry, {document, Date: Clock, location: {replace(url) {destination = url;}},
    memtofitGate: {start: async () => ({id: 'test-slot', name: 'test', row})},
    memtofitSlot: {load: async () => row}, memtofitCrypto: {decryptPlan: async (_, html) => html}});
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return {destination, elements};
}

(async () => {
  const html = '<h1>Test’s Gym</h1><p data-start="2026-10-26" data-weeks="12"></p>';
  for (const today of [new Date(2026, 9, 20), new Date(2026, 9, 26), new Date(2026, 11, 28)]) {
    assert.equal((await landing(html, today)).destination, 'program.html?s=test-slot', 'pre-start and weeks 1–10 open program');
  }
  for (const today of [new Date(2027, 0, 4), new Date(2027, 0, 11)]) {
    const result = await landing(html, today);
    assert.equal(result.destination, '', 'weeks 11–12 show choices');
    assert.match(result.elements.guide.textContent, /nearly finished/);
    assert.equal(result.elements['program-link'].classList.contains('is-disabled'), false);
  }
  const done = await landing(html, new Date(2027, 0, 18));
  assert.match(done.elements.guide.textContent, /program is finished/);
  const empty = await landing('', new Date(2026, 9, 20));
  assert.match(empty.elements.guide.textContent, /Start the questionnaire/);
  assert.equal(empty.elements['program-link'].classList.contains('is-disabled'), true);
  const legacy = await landing(html.replace('data-weeks="12"', 'data-weeks=""'), new Date(2026, 9, 20));
  assert.equal(legacy.destination, '', 'unknown legacy dates retain accessible choices');

  // Execute the actual hydration listener: authored defaults must never replace user notes.
  const template = read('plan-template.html');
  const hydration = template.slice(template.indexOf('  window.addEventListener("message",'), template.indexOf('  tell({ type: "memtofit-ready" });'));
  const parent = {};
  const notes = [{dataset: {day: '0-0'}, defaultValue: 'Setup comfort:', value: ''},
    {dataset: {day: '0-1'}, defaultValue: 'Hip response:', value: ''},
    {dataset: {day: '0-2'}, defaultValue: 'Skipped at cap:', value: ''}];
  let handle;
  vm.runInNewContext(hydration, {window: {parent, addEventListener: (_, fn) => {handle = fn;}},
    document: {querySelectorAll: selector => selector === '.day-note' ? notes : []}, applyUnit() {}, applyLoad() {}, applyPlace() {}});
  handle({source: parent, data: {type: 'memtofit-hydrate', data: {days: {'0-1': {v: 'My existing feedback'}, '0-2': {v: ''}}}}});
  assert.deepEqual(notes.map(n => n.value), ['Setup comfort:', 'My existing feedback', '']);
  handle({source: {}, data: {type: 'memtofit-hydrate', data: {days: {}}}});
  assert.equal(notes[1].value, 'My existing feedback', 'ignore messages from other sources');

  // Clearing a prompt remains a dated user choice, so it stays cleared after reload/merge.
  const program = read('program.js');
  const put = program.slice(program.indexOf('  function put(map,'), program.indexOf('  function putLoad('));
  let saves = 0;
  const context = {Date, persist() {saves++;}};
  vm.runInNewContext(put, context);
  const days = {};
  context.put(days, '0-0', '');
  assert.equal(days['0-0'].v, '');
  assert.ok(days['0-0'].at);
  assert.equal(saves, 1);
  console.log('Entry-page policy, feedback hydration and cleared-note checks passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
