// Maths written in LaTeX, as words to read aloud: '\frac{r}{2}\cos\theta' -> 'r over 2 cosine theta'.
// It covers what cards are likely to hold, not all of LaTeX: commands it does not know are
// read by name. The words are English, whatever the language of the side.

const GREEK = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon', varepsilon: 'epsilon',
  zeta: 'zeta', eta: 'eta', theta: 'theta', vartheta: 'theta', iota: 'iota', kappa: 'kappa', lambda: 'lambda',
  mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', rho: 'rho', sigma: 'sigma', tau: 'tau', upsilon: 'upsilon',
  phi: 'phi', varphi: 'phi', chi: 'chi', psi: 'psi', omega: 'omega',
  Gamma: 'capital gamma', Delta: 'capital delta', Theta: 'capital theta', Lambda: 'capital lambda',
  Xi: 'capital xi', Pi: 'capital pi', Sigma: 'capital sigma', Phi: 'capital phi', Psi: 'capital psi',
  Omega: 'capital omega',
};

const FUNCTIONS = {
  sin: 'sine', cos: 'cosine', tan: 'tangent', cot: 'cotangent', sec: 'secant', csc: 'cosecant',
  arcsin: 'arc sine', arccos: 'arc cosine', arctan: 'arc tangent', sinh: 'hyperbolic sine',
  cosh: 'hyperbolic cosine', tanh: 'hyperbolic tangent', ln: 'natural log', log: 'log', exp: 'exp',
  det: 'determinant', min: 'min', max: 'max', lim: 'limit', dim: 'dimension', rank: 'rank', tr: 'trace',
};

const SYMBOLS = {
  '=': 'equals', '+': 'plus', '-': 'minus', '<': 'is less than', '>': 'is greater than', '/': 'over',
  ':': 'from', '.': '', '°': 'degrees', '!': 'factorial', "'": 'prime',
  le: 'is less than or equal to', leq: 'is less than or equal to', ge: 'is greater than or equal to',
  geq: 'is greater than or equal to', ne: 'is not equal to', neq: 'is not equal to', approx: 'is approximately',
  equiv: 'is equivalent to', sim: 'is similar to', propto: 'is proportional to', pm: 'plus or minus',
  mp: 'minus or plus', cdot: 'times', div: 'divided by', in: 'in', notin: 'not in', subset: 'is a subset of',
  subseteq: 'is a subset of', cup: 'union', cap: 'intersection', setminus: 'minus', emptyset: 'the empty set',
  to: 'to', rightarrow: 'to', mapsto: 'maps to', Rightarrow: 'which gives', implies: 'which gives',
  Leftrightarrow: 'if and only if', iff: 'if and only if', forall: 'for all', exists: 'there exists',
  infty: 'infinity', partial: 'partial', nabla: 'del', wedge: 'wedge', times: 'cross', otimes: 'tensor',
  circ: 'composed with', perp: 'perpendicular to', parallel: 'parallel to', angle: 'angle', degree: 'degrees',
  cdots: 'dot dot dot', ldots: 'dot dot dot', dots: 'dot dot dot', vdots: 'dot dot dot', ddots: 'dot dot dot',
  ell: 'l',
};

const ACCENTS = { dot: 'dot', ddot: 'double dot', hat: 'hat', bar: 'bar', tilde: 'tilde', overline: 'bar' };
const STYLES = new Set(['mathbb', 'mathbf', 'mathrm', 'mathit', 'mathcal', 'mathsf', 'boldsymbol', 'bm', 'operatorname']);
const SPACES = new Set([',', ':', ';', ' ', '!', 'quad', 'qquad', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'limits']);
const MATRICES = new Set(['matrix', 'bmatrix', 'pmatrix', 'vmatrix', 'Bmatrix', 'smallmatrix']);
const POWERS = { 2: 'squared', 3: 'cubed', T: 'transpose', '-1': 'inverse' };

function tokenize(latex) {
  return [...latex.matchAll(/\\([a-zA-Z]+|.)|(\d+(?:\.\d+)?)|(\s+)|(.)/gs)].map(([, cmd, num, space, ch]) =>
    cmd !== undefined ? { cmd } : num !== undefined ? { num } : space !== undefined ? { space: true } : { ch },
  );
}

/** Words for one piece of maths, such as 'x squared plus y squared equals 1'. */
export function mathSpeech(latex) {
  const tokens = tokenize(String(latex ?? ''));
  let at = 0;
  // Bars opened with | or \| and not yet closed.
  const open = [];

  const peek = () => tokens[at];
  const skipSpace = () => {
    while (tokens[at]?.space) at++;
  };
  const is = (token, ch) => token && (token.ch === ch || token.cmd === ch);

  /** The tokens of a {group} or a single token, as their own list, for reading on their own. */
  function argument() {
    skipSpace();
    const t = tokens[at];
    if (!t) return [];
    if (t.ch !== '{') {
      at++;
      return [t];
    }
    let depth = 0;
    const start = ++at;
    for (; at < tokens.length; at++) {
      if (tokens[at].ch === '{') depth++;
      else if (tokens[at].ch === '}' && depth-- === 0) break;
    }
    return tokens.slice(start, at++);
  }
  const rawText = (list) => list.map((t) => t.cmd ?? t.num ?? t.ch ?? ' ').join('');
  const read = (list) => mathSpeech(rawText(list.map((t) => (t.cmd !== undefined ? { ch: `\\${t.cmd}` } : t))));
  // Short enough to read without marking where it starts and ends, like 'r' or '2 d'.
  const simple = (list) => list.filter((t) => !t.space).length <= 1 || /^[\w\s]{1,3}$/.test(rawText(list));

  /** Read an environment, from just after \begin{name} to \end{name}. */
  function environment(name) {
    const start = at;
    let depth = 0;
    for (; at < tokens.length; at++) {
      if (tokens[at].cmd === 'begin') depth++;
      else if (tokens[at].cmd === 'end' && depth-- === 0) break;
    }
    const body = tokens.slice(start, at);
    if (at < tokens.length) {
      at++;
      argument();
    }
    const rows = [[[]]];
    depth = 0;
    for (const t of body) {
      if (t.cmd === 'begin') depth++;
      if (t.cmd === 'end') depth--;
      if (depth === 0 && t.cmd === '\\') rows.push([[]]);
      else if (depth === 0 && t.ch === '&') rows.at(-1).push([]);
      else rows.at(-1).at(-1).push(t);
    }
    const cells = rows.map((row) => row.map(read)).filter((row) => row.some(Boolean));
    if (!MATRICES.has(name)) return cells.map((row) => row.filter(Boolean).join(' ')).join(', ');
    if (cells.every((row) => row.length === 1)) return `the column vector ${cells.map((row) => row[0]).join(', ')}, end vector`;
    return `the matrix with rows ${cells.map((row) => row.join(', ')).join('; next row ')}, end matrix`;
  }

  /** Words for a superscript after `base`, such as 'squared' or 'to the n'. */
  function power(sup, base) {
    const text = rawText(sup).replace(/\s/g, '');
    // R^3 is 'R 3', and R^{k \times n} is 'R k by n'.
    if (base === 'space') return read(sup).replace(/ (cross|times) /g, ' by ');
    if (text in POWERS && !(text === 'T' && base === 'number')) return POWERS[text];
    if (text === '\\circ') return 'degrees';
    if (/^\\?prime$|^'+$/.test(text)) return 'prime';
    return simple(sup) ? `to the ${read(sup)}` : `to the power of ${read(sup)},`;
  }

  /** The next term and any sub- and superscripts on it. Returns words, or null at the end. */
  function term() {
    skipSpace();
    const t = tokens[at++];
    if (!t) return null;
    let words;
    // What came before ^ decides how it is read: 'R n' for a space, 'x squared' otherwise.
    let kind = 'symbol';
    // Read after any subscript: \dot\theta_1 is 'theta 1 dot'.
    let accent = '';

    if (t.num !== undefined) {
      words = t.num;
      kind = 'number';
    } else if (t.ch === '{') {
      at--;
      words = read(argument());
    } else if (t.ch === '(' || t.ch === '[') {
      words = '';
    } else if (t.ch === ')' || t.ch === ']') {
      words = ',';
      kind = 'group';
    } else if (t.ch === '|' || t.cmd === '|') {
      const name = t.ch ? 'absolute value' : 'norm';
      if (open.at(-1) === name) {
        open.pop();
        words = ',';
        kind = 'group';
      } else {
        open.push(name);
        words = `the ${name} of`;
      }
    } else if (t.ch === ',' || t.ch === ';') {
      words = ',';
    } else if (t.ch === '&' || t.ch === '}') {
      words = '';
    } else if (t.ch !== undefined) {
      words = SYMBOLS[t.ch] ?? t.ch;
      // A capital S or T with a power is a sphere or a torus: S^1 is 'S 1'.
      if (/^[ST]$/.test(t.ch)) kind = 'space';
    } else {
      const { cmd } = t;
      if (cmd === '\\') words = ',';
      else if (SPACES.has(cmd)) words = cmd === 'quad' || cmd === 'qquad' ? ',' : '';
      else if (cmd in GREEK) words = GREEK[cmd];
      else if (cmd in FUNCTIONS) {
        words = FUNCTIONS[cmd];
        skipSpace();
        if (is(peek(), '^')) {
          const save = at++;
          const sup = rawText(argument()).replace(/\s/g, '');
          if (sup === '-1') words = `inverse ${words}`;
          else at = save;
        }
        kind = 'function';
      } else if (cmd in ACCENTS) {
        words = read(argument());
        accent = ACCENTS[cmd];
      } else if (cmd === 'times') {
        // 2 \times 3 is '2 times 3'; S^1 \times S^1 is 'S 1 cross S 1'.
        const near = (step) => {
          let i = at - 1 + step;
          while (tokens[i]?.space) i += step;
          return tokens[i];
        };
        words = near(-1)?.num !== undefined && near(1)?.num !== undefined ? 'times' : 'cross';
      }
      else if (cmd === 'vec') words = `vector ${read(argument())}`;
      else if (STYLES.has(cmd)) {
        words = read(argument());
        if (cmd === 'mathbb') kind = 'space';
      } else if (cmd === 'text' || cmd === 'textrm' || cmd === 'mbox' || cmd === 'textit' || cmd === 'textbf') {
        words = rawText(argument()).trim();
      } else if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const top = argument();
        const bottom = argument();
        const [a, b] = [read(top), read(bottom)];
        // Derivatives: d/dt, and the partial of g by the partial of theta.
        if (/^(d|partial)( |$)/.test(a) && /^(d|partial) /.test(b)) words = `${a} by ${b}`;
        else if (simple(top) && simple(bottom)) words = `${a} over ${b}`;
        else words = `the fraction ${a}, over ${b}, end fraction`;
        kind = 'group';
      } else if (cmd === 'sqrt') {
        const inner = argument();
        words = simple(inner) ? `root ${read(inner)}` : `the square root of ${read(inner)},`;
        kind = 'group';
      } else if (cmd === 'sum' || cmd === 'prod' || cmd === 'int') {
        const name = { sum: 'the sum', prod: 'the product', int: 'the integral' }[cmd];
        let from = '';
        let to = '';
        for (;;) {
          skipSpace();
          if (is(peek(), '_')) (at++, (from = read(argument())));
          else if (is(peek(), '^')) (at++, (to = read(argument())));
          else break;
        }
        words = `${name}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''} of`;
        return words;
      } else if (cmd === 'underbrace' || cmd === 'overbrace') {
        words = read(argument());
        skipSpace();
        if (is(peek(), '_') || is(peek(), '^')) {
          at++;
          words += `, the ${read(argument())},`;
        }
        return words;
      } else if (cmd === 'begin') {
        return environment(rawText(argument()).trim());
      } else if (cmd === 'end') {
        argument();
        words = '';
      } else words = SYMBOLS[cmd] ?? cmd;
    }

    for (;;) {
      skipSpace();
      if (is(peek(), '_')) {
        at++;
        words += ` ${read(argument())}`;
      } else if (is(peek(), '^')) {
        at++;
        words += `${accent && ` ${accent}`} ${power(argument(), kind)}`;
        accent = '';
      } else break;
    }
    return accent ? `${words} ${accent}` : words;
  }

  /**
   * Words for the bracket just read. After a number it multiplies: 3(4 - 1) is '3 times 4 minus 1'.
   * After a function it is what the function is given: g(\theta) is 'g of theta'. After a letter
   * it could be either, so a sum or difference inside is taken as multiplying, as in m(N - 1).
   */
  function bracketWord() {
    let i = at - 2;
    while (i >= 0 && (tokens[i].space || SPACES.has(tokens[i].cmd))) i--;
    const before = tokens[i];
    if (!before) return '';
    const scripted = ['_', '^'].includes(tokens[i - 1]?.ch) || before.ch === '}';
    if (before.num !== undefined && !scripted) return 'times,';
    if (before.cmd in FUNCTIONS || /\^\{-1\}$/.test(rawText(tokens.slice(Math.max(0, i - 4), i + 1)))) return 'of';
    const named = scripted || before.ch === ')' || before.cmd in GREEK || /^[a-zA-Z]$/.test(before.ch ?? '');
    if (!named) return '';
    let depth = 0;
    for (let j = at; j < tokens.length; j++) {
      const ch = tokens[j].ch;
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth-- === 0) break;
      } else if (depth === 0 && (ch === '+' || ch === '-')) return 'times,';
    }
    return 'of';
  }

  const words = [];
  for (let w; (w = term()) !== null; ) {
    const prev = tokens[at - 1];
    if (w === '' && (prev?.ch === '(' || prev?.ch === '[')) w = bracketWord();
    words.push(w);
  }
  return words
    .filter(Boolean)
    .join(' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/\s+/g, ' ');
}
