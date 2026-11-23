'use strict';

const $ = id => document.getElementById(id);
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo', dateStyle:'short'}).format(new Date());
const monthAfter = month => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
};
const monthLabel = month => month.replace('-', '年') + '月';
const money = amount => amount == null ? '未確認' : new Intl.NumberFormat('ja-JP', {style:'currency',currency:'JPY'}).format(amount);
const sum = values => !values.length || values.some(value => value == null) ? null : values.reduce((total, value) => total + value, 0);
const amount = value => value === '' ? null : Number(value);
const id = () => crypto.randomUUID();
const key = 'kuroneko-budget-demo-v1';
const saved = localStorage.getItem(key);
const state = saved ? JSON.parse(saved) : demoState(today());
const positionTypes = {cash:'現金残高',bank:'銀行口座残高',card:'カード・後払い未払金',fixed:'今後の固定費',invest:'今後のつみたてNISA',budget:'残りの予算'};
const kinds = {expense:'支出実績',salary:'給与',settlement:'引落精算',invest:'NISA積立実績'};
const defaults = [
  ['cash','財布',null], ['bank','給与口座',null], ['bank','生活費口座',null], ['bank','予備口座',null],
  ['card','メインカード',null], ['card','サブカード',null], ['card','後払い',null],
  ['fixed','家賃（未払い分）',null], ['fixed','その他の固定費（未払い分）',null],
  ['invest','NISA（未積立分）',null], ['budget','生活費（残り）',null], ['budget','その他の残りの予算',null]
];
const forecastFields = [
  ['opening','翌月初の現金・口座残高',null,true], ['salary','翌月入金の給与',null],
  ['cards','翌月引落のカード・後払い',null], ['rent','翌月支払う家賃',null],
  ['living','翌月に現金・口座から払う生活費',null], ['food','翌月に現金・口座から払う食費',null],
  ['fixed','その他の固定費・支出',null], ['invest','つみたてNISA',null],
  ['car','自動車ローンの通常返済',null], ['payoff','一括返済額（手数料込み）',null], ['withdraw','NISA取り崩しの翌月入金額',null]
];
const transaction = $('transaction');
const field = name => transaction.elements.namedItem(name);
let editing = null;
let activeMonth = today().slice(0,7);
$('month').value = activeMonth;

function persist(status) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    $(status).textContent = '保存しました';
  } catch {
    $(status).textContent = 'ブラウザに保存できませんでした';
  }
}

function make(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function labeled(title, input) {
  const label = make('label', title);
  label.append(input);
  return label;
}

function numeric(value, signed = false) {
  const input = make('input');
  input.type = 'number';
  if (!signed) input.min = '0';
  input.step = '1';
  input.placeholder = '未確認';
  input.value = value ?? '';
  return input;
}

function positionRow([type, name, value]) {
  const row = make('div', null, 'position');
  const select = make('select');
  for (const [optionValue, label] of Object.entries(positionTypes)) {
    const option = make('option', label);
    option.value = optionValue;
    select.append(option);
  }
  select.value = type;
  const title = make('input');
  title.value = name;
  title.required = true;
  title.maxLength = 80;
  const remove = make('button', '項目を外す', 'quiet');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    row.remove();
    $('positionStatus').textContent = '変更を反映するには保存してください';
  });
  row.append(labeled('区分', select), labeled('項目名', title), labeled('金額（円）', numeric(value, type === 'bank')), remove);
  select.addEventListener('change', () => row.querySelector('input[type=number]').min = select.value === 'bank' ? '' : '0');
  return row;
}

function drawPositions() {
  const record = state.actual[activeMonth];
  const date = make('input');
  date.type = 'date';
  date.required = true;
  date.name = 'asOf';
  date.min = activeMonth + '-01';
  date.max = monthAfter(activeMonth) + '-01';
  date.max = new Date(Date.parse(date.max) - 86400000).toISOString().slice(0,10);
  date.value = record?.date ?? (today().startsWith(activeMonth) ? today() : date.max);
  $('positions').replaceChildren(labeled('残高の基準日', date), ...(record?.rows ?? defaults).map(positionRow));
}

$('addPosition').addEventListener('click', () => {
  const row = positionRow(['bank','',null]);
  $('positions').append(row);
  row.querySelector('input').focus();
});
$('position').addEventListener('submit', event => {
  event.preventDefault();
  const rows = [...$('positions').querySelectorAll('.position')].map(row => {
    const [name, value] = row.querySelectorAll('input');
    return [row.querySelector('select').value, name.value.trim(), amount(value.value)];
  });
  state.actual[activeMonth] = {date:event.currentTarget.elements.asOf.value, rows};
  persist('positionStatus');
  drawActual();
});

function clearEntry() {
  editing = null;
  transaction.reset();
  field('date').value = today().startsWith(activeMonth) ? today() : activeMonth + '-01';
  $('saveEntry').textContent = '明細を追加';
  $('cancelEdit').hidden = true;
  syncEntryFields();
}
function syncEntryFields() {
  field('category').disabled = field('kind').value !== 'expense';
}
field('kind').addEventListener('change', syncEntryFields);
$('cancelEdit').addEventListener('click', clearEntry);
transaction.addEventListener('submit', event => {
  event.preventDefault();
  const entry = Object.fromEntries(new FormData(transaction));
  entry.amount = amount(entry.amount);
  entry.id = editing ?? id();
  const index = state.transactions.findIndex(item => item.id === entry.id);
  if (index === -1) state.transactions.push(entry);
  else state.transactions[index] = entry;
  if (entry.date.slice(0,7) !== activeMonth) {
    $('month').value = entry.date.slice(0,7);
    changeMonth();
  } else {
    clearEntry();
    drawActual();
  }
  persist('entryStatus');
});

function editEntry(entry) {
  editing = entry.id;
  for (const name of ['date','kind','method','category','amount','memo']) {
    field(name).value = entry[name] ?? (name === 'category' ? '食費' : '');
  }
  syncEntryFields();
  $('saveEntry').textContent = '明細を更新';
  $('cancelEdit').hidden = false;
  field('date').focus();
}

function rowOf(values) {
  const row = make('tr');
  for (const value of values) row.append(make('td', value));
  return row;
}

function drawEntries(entries) {
  $('entries').replaceChildren();
  if (!entries.length) {
    const row = rowOf(['登録済みの明細はありません']);
    row.firstChild.colSpan = 6;
    $('entries').append(row);
    return;
  }
  for (const entry of entries.sort((a,b) => b.date.localeCompare(a.date))) {
    const row = rowOf([entry.date, [kinds[entry.kind],entry.category].filter(Boolean).join('・'), entry.method, entry.memo || '—', money(entry.amount)]);
    row.lastChild.className = 'num';
    const actions = make('td');
    const edit = make('button', '編集', 'quiet');
    const remove = make('button', '削除', 'quiet');
    edit.onclick = () => editEntry(entry);
    remove.onclick = () => {
      if (!confirm('この明細を削除しますか？')) return;
      state.transactions = state.transactions.filter(item => item.id !== entry.id);
      if (editing === entry.id) clearEntry();
      persist('entryStatus');
      drawActual();
    };
    actions.append(edit, ' ', remove);
    row.append(actions);
    $('entries').append(row);
  }
}

function drawActual() {
  const month = activeMonth;
  $('period').textContent = monthLabel(month) + 'の暦月集計';
  const entries = state.transactions.filter(item => item.date.startsWith(month));
  const totals = (list, kind, category) => sum(list.filter(item => item.kind === kind && (!category || item.category === category)).map(item => item.amount));
  const rows = state.actual[month]?.rows ?? defaults;
  const position = (...types) => sum(rows.filter(([type]) => types.includes(type)).map(row => row[2]));
  const cash = position('cash');
  const bank = position('bank');
  const cards = position('card');
  const fixed = position('fixed');
  const invest = position('invest');
  const budget = position('budget');
  const base = sum([cash,bank]);
  const commitments = sum([cards,fixed,invest,budget]);
  const free = base == null || commitments == null ? null : base - commitments;
  const data = [
    ['自由に使える金額',free,'残高 − 未払金・固定費・積立・残りの予算'],
    ['現金・口座残高',base,state.actual[month]?.date ?? '基準日未確認'],
    ['カード等の未払金',cards,'基準日時点'],
    ['支出実績',totals(entries,'expense'),'暦月・登録分'],
    ['食費実績',totals(entries,'expense','食費'),'暦月・登録分'],
    ['NISA積立実績',totals(entries,'invest'),'暦月・登録分'],
    ['給与（入金日）',totals(entries,'salary'),'1日〜末日・登録分']
  ];
  $('metrics').replaceChildren(...data.map(([title,value,detail], index) => {
    const card = make('div',null,index ? 'metric' : 'metric primary');
    card.append(make('span',title),make('strong',money(value)),make('small',detail));
    return card;
  }));
  drawEntries(entries);
}

function drawForecast() {
  const next = monthAfter(activeMonth);
  $('planTitle').textContent = monthLabel(next) + 'の資金計画';
  const saved = state.forecast[next] ?? {};
  $('assumptions').replaceChildren(...forecastFields.map(([key,title,initial,signed]) => {
    const input = numeric(Object.hasOwn(saved,key) ? saved[key] : initial,signed);
    input.name = key;
    return labeled(title,input);
  }));
  drawScenarios();
}

function compareScenarios(a) {
  const shared = [a.cards,a.rent,a.living,a.food,a.fixed];
  const normal = sum([...shared,a.invest,a.car]);
  const pause = sum([...shared,a.car]);
  const payoff = sum([...shared,a.invest,a.payoff]);
  const pauseAndPay = sum([...shared,a.payoff]);
  return [
    ['通常どおり',normal,0],
    ['NISAを取り崩す',normal,a.withdraw],
    ['積み立てを止める',pause,0],
    ['自動車ローンを一括返済',payoff,0],
    ['取り崩し＋積立停止＋一括返済',pauseAndPay,a.withdraw]
  ].map(([title,outflow,withdrawal]) => {
    const net = a.salary == null || outflow == null ? null : a.salary - outflow;
    const balance = sum([a.opening,net,withdrawal]);
    return {title,outflow,net,balance};
  });
}

function drawScenarios() {
  const assumptions = Object.fromEntries([...$('assumptions').querySelectorAll('input')].map(input => [input.name, amount(input.value)]));
  $('scenarios').replaceChildren(...compareScenarios(assumptions).map(({title,outflow,net,balance}) => {
    const verdict = net == null ? '未確認' : net > 0 ? '黒字' : net < 0 ? '赤字' : '収支均衡';
    const row = rowOf([title,money(outflow),money(balance),money(net),verdict]);
    for (const cell of [...row.children].slice(1,4)) cell.classList.add('num');
    row.lastChild.className = net == null ? 'muted' : net < 0 ? 'bad' : 'good';
    if (balance < 0) row.children[2].classList.add('bad');
    return row;
  }));
}

$('forecast').addEventListener('input', () => {
  $('planStatus').textContent = '未保存の変更';
  if ($('forecast').checkValidity()) drawScenarios();
  else $('scenarios').replaceChildren();
});
$('forecast').addEventListener('submit', event => {
  event.preventDefault();
  state.forecast[monthAfter(activeMonth)] = Object.fromEntries([...new FormData(event.currentTarget)].map(([key,value]) => [key,amount(value)]));
  persist('planStatus');
});

function changeMonth() {
  if (!$('month').validity.valid) return;
  activeMonth = $('month').value;
  for (const name of ['entryStatus','positionStatus','planStatus']) $(name).textContent = '';
  clearEntry();
  drawPositions();
  drawActual();
  drawForecast();
}
$('month').addEventListener('change', changeMonth);
for (const name of ['actual','plan']) {
  $(name + 'Tab').addEventListener('click', () => {
    for (const tab of ['actual','plan']) {
      $(tab).hidden = tab !== name;
      $(tab + 'Tab').setAttribute('aria-pressed', String(tab === name));
    }
  });
}
changeMonth();

function demoState(date) {
  const month = date.slice(0,7);
  const next = monthAfter(month);
  return {
    transactions: [
      {id:'demo-1',date:month+'-02',kind:'expense',category:'食費',method:'カード',amount:4280,memo:'スーパー'},
      {id:'demo-2',date:month+'-04',kind:'expense',category:'生活費',method:'現金',amount:1720,memo:'日用品'},
      {id:'demo-3',date:month+'-15',kind:'settlement',method:'銀行口座',amount:18500,memo:'先月利用分の引落'},
      {id:'demo-4',date:month+'-25',kind:'salary',method:'銀行口座',amount:216000,memo:'給与'}
    ],
    actual: {
      [month]: {date:month+'-25',rows:[
        ['cash','財布',8500], ['bank','生活費口座',142500], ['card','メインカード',24500],
        ['fixed','家賃と固定費',69000], ['invest','今後のつみたてNISA',8000], ['budget','残りの予算',10500]
      ]}
    },
    forecast: {
      [next]: {opening:61000,salary:216000,cards:42000,rent:62000,living:11500,food:23000,fixed:39000,invest:8000,car:17000,payoff:58000,withdraw:35000}
    }
  };
}
