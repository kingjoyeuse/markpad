/** Small, bounded expression interpreter. Never executes JavaScript. */
export class FormulaError extends Error {
  constructor(code = '#VALUE!', message = code) { super(message); this.name = 'FormulaError'; this.code = code; }
}

const CURRENCY = /\p{Sc}/u;
const MAX_EXPRESSION_LENGTH = 20000;
const MAX_NODES = 10000;
const MAX_DEPTH = 128;

function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new FormulaError('#NUM!', 'The result is outside the supported number range.');
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Parse a complete numeric value, including currency symbols. US grouping is
 * the default. A comma with one/two trailing digits is treated as a decimal;
 * with three it is a thousands separator. Both separators identify locale by
 * their order, provided grouping is well formed.
 */
export function parseNumberLiteral(input) {
  let text = String(input).trim().replace(/\u2212/g, '-').replace(/[\u00a0\u202f]/g, ' ');
  if (!text || text.length > 512) return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    // Parentheses are mathematical grouping unless a currency symbol makes
    // accounting notation explicit: (2) is 2; ($2) is -2.
    if (!CURRENCY.test(text)) return null;
    negative = true; text = text.slice(1, -1).trim();
  }
  let signSeen = false;
  if (/^[+-]/.test(text)) { negative = text[0] === '-' ? !negative : negative; signSeen = true; text = text.slice(1).trim(); }
  if (text && CURRENCY.test(text[0])) text = text.slice(1).trim();
  if (!signSeen && /^[+-]/.test(text)) { negative = text[0] === '-' ? !negative : negative; text = text.slice(1).trim(); }
  if (text && CURRENCY.test(text.at(-1))) text = text.slice(0, -1).trim();
  if (!text || CURRENCY.test(text) || /[^\d., eE+-]/.test(text)) return null;

  let exponent = '';
  const exponentMatch = text.match(/[eE][+-]?\d+$/);
  if (exponentMatch) { exponent = exponentMatch[0]; text = text.slice(0, -exponent.length); }
  if (/[eE+-]/.test(text)) return null;
  // Spaces are grouping separators only, never arbitrary whitespace in digits.
  if (text.includes(' ')) {
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(text)) return null;
    text = text.replaceAll(' ', '');
  }
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (dot > comma) {
      if (!/^\d{1,3}(?:,\d{3})+\.\d+$/.test(text)) return null;
      text = text.replaceAll(',', '');
    } else {
      if (!/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) return null;
      text = text.replaceAll('.', '').replace(',', '.');
    }
  } else if (comma >= 0) {
    if (/^\d{1,3}(?:,\d{3})+$/.test(text)) text = text.replaceAll(',', '');
    else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
    else return null;
  } else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(text)) text=text.replaceAll('.','');
  else if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text + exponent) * (negative ? -1 : 1);
  return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
}

function lex(source) {
  const tokens = [];
  let pos = 0;
  const parentheses = [];
  const add = (type, value, extra = {}) => {
    tokens.push({type, value, ...extra});
    if (tokens.length > MAX_NODES) throw new FormulaError('#NUM!', 'This expression is too large.');
  };
  while (pos < source.length) {
    const rest = source.slice(pos);
    if (/^\s/.test(rest)) { pos++; continue; }
    const character = rest[0];
    const errorLiteral=rest.match(/^#(?:REF!|VALUE!|DIV\/0!|NUM!|NAME\?|N\/A|CYCLE!|ERROR!)/i);
    if (errorLiteral) { add('literal',errorLiteral[0].toUpperCase()); pos += errorLiteral[0].length; continue; }
    if (character === '"') {
      let value = ''; let end = pos + 1; let closed = false;
      while (end < source.length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') { value += '"'; end += 2; continue; }
          closed = true; end++; break;
        }
        value += source[end++];
      }
      if (!closed) throw new FormulaError('#VALUE!', 'Unclosed text literal.');
      add('literal', value); pos = end; continue;
    }
    // Quoted sheet names use Excel's doubled-apostrophe escaping.
    const quotedReference = rest.match(/^'((?:[^']|'')+)'!(\$?[A-Za-z]{1,3}\$?\d+)/);
    if (quotedReference) {
      add('reference', quotedReference[2].toUpperCase(), {sheet: quotedReference[1].replaceAll("''", "'")});
      pos += quotedReference[0].length; continue;
    }
    const sheetReference = rest.match(/^([A-Za-z_][A-Za-z0-9_. ]*)!(\$?[A-Za-z]{1,3}\$?\d+)/);
    if (sheetReference) {
      add('reference', sheetReference[2].toUpperCase(), {sheet: sheetReference[1]}); pos += sheetReference[0].length; continue;
    }
    // A dollar-prefixed cell reference is not a currency amount.
    const absoluteReference=rest.match(/^\$[A-Za-z]{1,3}\$?[1-9]\d*(?![A-Za-z0-9_.])/);
    if(absoluteReference){add('reference',absoluteReference[0].toUpperCase());pos+=absoluteReference[0].length;continue;}
    const currencyPrefix = CURRENCY.test(character);
    if (/\d|\./.test(character) || currencyPrefix) {
      let start = currencyPrefix ? 1 : 0;
      while (currencyPrefix && /\s/.test(rest[start] || 'x')) start++;
      const numberRest = rest.slice(start);
      const functionContext = parentheses.some(Boolean);
      // In functions commas separate arguments. Currency prefixes make grouped
      // values explicit; otherwise use A1 references or ungrouped numeric args.
      const numericPattern = !functionContext || currencyPrefix
        ? /^(?:\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
        : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
      const numeric = numberRest.match(numericPattern);
      if (!numeric) throw new FormulaError('#VALUE!', 'Invalid number.');
      let consumed = start + numeric[0].length;
      const suffix = rest.slice(consumed).match(/^\s*(\p{Sc})/u);
      if (suffix) consumed += suffix[0].length;
      const raw = rest.slice(0, consumed);
      const value = parseNumberLiteral(raw);
      if (value === null) throw new FormulaError('#VALUE!', `Invalid number: ${raw}`);
      add('literal', value); pos += consumed; continue;
    }
    const identifier = rest.match(/^\$?[A-Za-z_][A-Za-z0-9_.$]*/);
    if (identifier) {
      const value = identifier[0].toUpperCase();
      const isFunction = /^\s*\(/.test(rest.slice(identifier[0].length));
      if (!isFunction && /^\$?[A-Z]{1,3}\$?\d+$/.test(value)) add('reference', value);
      else add('identifier', value);
      pos += identifier[0].length; continue;
    }
    const operator = rest.match(/^(?:<=|>=|<>|!=|==|[+\-*/^%&=<>(),;:])/);
    if (!operator) throw new FormulaError('#VALUE!', `Unsupported character: ${character}`);
    const value = operator[0];
    if (value === '(') parentheses.push(tokens.at(-1)?.type === 'identifier');
    if (value === ')') parentheses.pop();
    add('operator', value); pos += value.length;
  }
  add('end', ''); return tokens;
}

function parse(source) {
  const tokens = lex(source); let index = 0; let depth = 0;
  const peek = () => tokens[index];
  const take = value => { if (peek().value === value) { index++; return true; } return false; };
  const require = value => { if (!take(value)) throw new FormulaError('#VALUE!', `Expected ${value}.`); };
  const guard = fn => {
    if (++depth > MAX_DEPTH) throw new FormulaError('#NUM!', 'This expression is nested too deeply.');
    try { return fn(); } finally { depth--; }
  };
  function primary() { return guard(() => {
    const token = peek();
    if (take('(')) { const expression = comparison(); require(')'); return expression; }
    if (token.type === 'literal') { index++; return {type:'literal', value:token.value}; }
    if (token.type === 'reference') {
      index++;
      if (take(':')) {
        const end = peek();
        if (end.type !== 'reference') throw new FormulaError('#REF!', 'A range needs two cell addresses.');
        index++; return {type:'range', start:token, end};
      }
      return {type:'reference', ...token};
    }
    if (token.type === 'identifier') {
      index++;
      if (take('(')) {
        const args = [];
        if (!take(')')) { do { args.push(comparison()); } while (take(',') || take(';')); require(')'); }
        return {type:'function', name:token.value, args};
      }
      if (token.value === 'TRUE' || token.value === 'FALSE') return {type:'literal', value:token.value === 'TRUE'};
      if (token.value === 'PI') return {type:'literal', value:Math.PI};
      if (token.value === 'E') return {type:'literal', value:Math.E};
      throw new FormulaError('#NAME?', `Unknown name: ${token.value}`);
    }
    throw new FormulaError('#VALUE!', 'An operand is missing.');
  }); }
  function postfix() { let node = primary(); while (take('%')) node = {type:'percent', node}; return node; }
  // Mathematical precedence: -2^2 = -(2^2), and exponentiation associates right.
  function power() { let node = postfix(); if (take('^')) node = {type:'binary', op:'^', left:node, right:unary()}; return node; }
  function unary() { return guard(() => take('+') ? {type:'unary', op:'+', node:unary()} : take('-') ? {type:'unary', op:'-', node:unary()} : power()); }
  function multiply() { let node = unary(); while (['*','/'].includes(peek().value)) { const op = tokens[index++].value; node = {type:'binary', op, left:node, right:unary()}; } return node; }
  function add() { let node = multiply(); while (['+','-'].includes(peek().value)) { const op = tokens[index++].value; node = {type:'binary', op, left:node, right:multiply()}; } return node; }
  function concatenate() { let node = add(); while (take('&')) node = {type:'binary', op:'&', left:node, right:add()}; return node; }
  function comparison() { let node = concatenate(); while (['=','==','!=','<>','<','>','<=','>='].includes(peek().value)) { const op = tokens[index++].value; node = {type:'binary', op, left:node, right:concatenate()}; } return node; }
  const tree = comparison();
  if (peek().type !== 'end') throw new FormulaError('#VALUE!', `Unexpected token: ${peek().value}`);
  return tree;
}

function isError(value) { return typeof value === 'string' && /^#(?:REF!|VALUE!|DIV\/0!|NUM!|NAME\?|N\/A|CYCLE!|ERROR!)/.test(value); }
function checkError(value) { if (isError(value)) throw new FormulaError(value); return value; }
function numeric(value) {
  checkError(value);
  if (Array.isArray(value)) throw new FormulaError('#VALUE!', 'A range cannot be used as a single value.');
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'boolean') return Number(value);
  if (value === '' || value == null) return 0;
  const parsed = parseNumberLiteral(value);
  if (parsed === null) throw new FormulaError('#VALUE!', 'This value is not numeric.');
  return parsed;
}
function truthy(value) {
  checkError(value);
  if (typeof value === 'boolean') return value;
  if (value === '' || value == null) return false;
  return numeric(value) !== 0;
}
function flatten(values) { return values.flat(Infinity); }
function arithmetic(op, a, b) {
  if (op === '&') {
    const lhs=String(checkError(a) ?? ''), rhs=String(checkError(b) ?? '');
    if (lhs.length+rhs.length>100000) throw new FormulaError('#NUM!', 'The text result is too large.');
    return lhs+rhs;
  }
  if (['=','==','!=','<>','<','>','<=','>='].includes(op)) {
    checkError(a); checkError(b);
    const lhs = typeof a === 'string' ? a.toLowerCase() : a;
    const rhs = typeof b === 'string' ? b.toLowerCase() : b;
    return ({'=':()=>lhs === rhs, '==':()=>lhs === rhs, '!=':()=>lhs !== rhs, '<>':()=>lhs !== rhs,
      '<':()=>lhs < rhs, '>':()=>lhs > rhs, '<=':()=>lhs <= rhs, '>=':()=>lhs >= rhs})[op]();
  }
  const lhs = numeric(a); const rhs = numeric(b);
  if (op === '/' && rhs === 0) throw new FormulaError('#DIV/0!', 'Cannot divide by zero.');
  return finite(({'+':()=>lhs+rhs, '-':()=>lhs-rhs, '*':()=>lhs*rhs, '/':()=>lhs/rhs, '^':()=>lhs**rhs})[op]());
}

function execute(tree, context) {
  let steps = 0;
  function run(node, depth = 0) {
    if (++steps > MAX_NODES || depth > MAX_DEPTH) throw new FormulaError('#NUM!', 'Expression evaluation limit reached.');
    const child = value => run(value, depth + 1);
    if (node.type === 'literal') return node.value;
    if (node.type === 'reference') {
      if (!context.resolveReference) throw new FormulaError('#REF!', 'Cell references require a spreadsheet.');
      return checkError(context.resolveReference(node.value, node.sheet));
    }
    if (node.type === 'range') {
      if (!context.resolveRange) throw new FormulaError('#REF!', 'Cell ranges require a spreadsheet.');
      if (node.end.sheet && node.start.sheet && node.end.sheet.toLowerCase() !== node.start.sheet.toLowerCase()) throw new FormulaError('#REF!', 'A range must be within one sheet.');
      return context.resolveRange(node.start.value, node.end.value, node.start.sheet || node.end.sheet);
    }
    if (node.type === 'percent') return finite(numeric(child(node.node)) / 100);
    if (node.type === 'unary') return finite(numeric(child(node.node)) * (node.op === '-' ? -1 : 1));
    if (node.type === 'binary') return arithmetic(node.op, child(node.left), child(node.right));
    if (node.type !== 'function') throw new FormulaError('#ERROR!');
    const name = node.name;
    const arity = (min, max = min) => { if (node.args.length < min || node.args.length > max) throw new FormulaError('#VALUE!', `${name} expects ${min === max ? min : `${min}–${max}`} arguments.`); };
    if (name === 'IF') { arity(2,3); return truthy(child(node.args[0])) ? child(node.args[1]) : node.args[2] ? child(node.args[2]) : false; }
    if (name === 'IFERROR') { arity(2); try { return checkError(child(node.args[0])); } catch (error) { if (!(error instanceof FormulaError)) throw error; return child(node.args[1]); } }
    if (name === 'PI') { arity(0); return Math.PI; }
    const values = flatten(node.args.map(child));
    values.forEach(checkError);
    const numericValues = () => values.filter(value => typeof value === 'number');
    if (name === 'SUM') return finite(numericValues().reduce((sum,value)=>sum+value,0));
    if (name === 'COUNT') return numericValues().length;
    if (name === 'COUNTA') return values.filter(value=>value !== '' && value != null).length;
    if (name === 'AVERAGE') { const nums = numericValues(); if (!nums.length) throw new FormulaError('#DIV/0!'); return finite(nums.reduce((sum,value)=>sum+value,0)/nums.length); }
    if (name === 'MIN' || name === 'MAX') { const nums = numericValues(); return nums.length ? finite(nums.reduce((best,value)=>(name === 'MIN'?Math.min:Math.max)(best,value))) : 0; }
    if (name === 'AND') { arity(1,255); return values.every(truthy); }
    if (name === 'OR') { arity(1,255); return values.some(truthy); }
    if (name === 'NOT') { arity(1); return !truthy(values[0]); }
    if (name === 'ABS') { arity(1); return Math.abs(numeric(values[0])); }
    if (name === 'SQRT') { arity(1); return finite(Math.sqrt(numeric(values[0]))); }
    if (name === 'POWER') { arity(2); return finite(numeric(values[0]) ** numeric(values[1])); }
    if (name === 'MOD') { arity(2); const a=numeric(values[0]), b=numeric(values[1]); if (b === 0) throw new FormulaError('#DIV/0!'); return finite(a-b*Math.floor(a/b)); }
    if (name === 'ROUND' || name === 'ROUNDUP' || name === 'ROUNDDOWN') {
      arity(1,2); const value=numeric(values[0]), digits=values.length>1?Math.trunc(numeric(values[1])):0;
      if (Math.abs(digits) > 308) throw new FormulaError('#NUM!');
      const scale=10**digits, absolute=Math.abs(value)*scale;
      const rounded=name === 'ROUNDUP' ? Math.ceil(absolute) : name === 'ROUNDDOWN' ? Math.floor(absolute) : Math.floor(absolute+0.5+Number.EPSILON*absolute);
      return finite(Math.sign(value)*rounded/scale);
    }
    if (name === 'FLOOR' || name === 'CEILING') {
      arity(1,2); const value=numeric(values[0]), step=values.length>1?Math.abs(numeric(values[1])):1;
      if (!step) return 0;
      return finite((name === 'FLOOR'?Math.floor:Math.ceil)(value/step)*step);
    }
    if (name === 'INT') { arity(1); return Math.floor(numeric(values[0])); }
    if (name === 'LEN') { arity(1); return String(values[0] ?? '').length; }
    if (name === 'CONCAT' || name === 'CONCATENATE') {
      if (values.reduce((length,value)=>length+String(value ?? '').length,0)>100000) throw new FormulaError('#NUM!', 'The text result is too large.');
      return values.join('');
    }
    throw new FormulaError('#NAME?', `Unsupported function: ${name}`);
  }
  return run(tree);
}

export function evaluateExpression(input, context = {}) {
  let source = String(input).trim().replace(/[×⋅]/g, '*').replace(/÷/g, '/').replace(/\u2212/g, '-');
  if (source.startsWith('=')) source = source.slice(1).trim();
  if (!source) throw new FormulaError('#VALUE!', 'Enter a number or expression.');
  if (source.length > MAX_EXPRESSION_LENGTH) throw new FormulaError('#NUM!', 'This expression is too large.');
  const number = parseNumberLiteral(source);
  if (number !== null) return number;
  return execute(parse(source), context);
}

export function formatNumber(value) {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number') return String(value ?? '');
  if (!Number.isFinite(value)) return '#NUM!';
  if (Object.is(value, -0) || value === 0) return '0';
  // Hide binary floating point noise, without pretending to provide decimal
  // accounting arithmetic. Storage always retains the formula/input string.
  return String(Number(value.toPrecision(15)));
}

export function inspectNumericSelection(input) {
  const text = String(input ?? '').trim();
  if (!text) return {valid:false,value:null,isEquation:false,text,error:'Select a number or equation.'};
  const literal = parseNumberLiteral(text);
  if (literal !== null) return {valid:true,value:literal,isEquation:false,text};
  const isEquation = /^=/.test(text) || /[+*/^%=×÷]/.test(text) || /\d\s*-/.test(text) || /[A-Za-z_]+\s*\(/.test(text);
  try {
    const value = evaluateExpression(text);
    if (typeof value !== 'number' || !Number.isFinite(value)) return {valid:false,value:null,isEquation,text,error:'The selection does not resolve to a number.'};
    return {valid:true,value,isEquation:true,text};
  } catch (error) { return {valid:false,value:null,isEquation,text,error:error.message || 'Invalid expression.'}; }
}
