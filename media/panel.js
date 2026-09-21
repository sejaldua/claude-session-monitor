// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const menu = document.getElementById('menu');

  /** Most-urgent first, then longest in that state. */
  const ORDER = { waiting: 0, stuck: 1, busy: 2, idle: 3 };

  function stateOf(row) {
    if (row.status === 'waiting') return 'waiting';
    if (row.status === 'busy') return row.stuck ? 'stuck' : 'busy';
    return 'idle';
  }

  const GLYPH = { waiting: '!', stuck: '~', busy: '›', idle: '·' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function send(type, id) {
    vscode.postMessage({ type, id });
  }

  // ---------- row builders, one per style ----------

  function buildRail(row, state) {
    const node = baseRow(row, state);
    node.append(el('span', 'title', row.title), el('span', 'age', ageText(row, state)));
    return node;
  }

  function buildDuration(row, state) {
    const node = baseRow(row, state);
    const top = el('div', 'bar-top');
    top.append(
      el('span', 'title s-' + state, row.title),
      el('span', 'age', ageText(row, state))
    );
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = Math.round(row.weight * 100) + '%';
    track.append(fill);
    node.append(top, track);
    return node;
  }

  function buildLedger(row, state) {
    const node = baseRow(row, state);
    node.append(
      el('span', 'glyph s-' + state, GLYPH[state]),
      el('span', state === 'idle' ? 'title s-idle' : 'title', row.title),
      el('span', 'project', row.project),
      el('span', 'age', row.age)
    );
    return node;
  }

  function buildPulse(row, state) {
    const node = baseRow(row, state);
    const spark = el('span', 'spark');
    spark.setAttribute('aria-hidden', 'true');
    for (const sample of row.spark) {
      const bar = el('i');
      bar.dataset.s = sample;
      spark.append(bar);
    }
    node.append(
      spark,
      el('span', state === 'idle' ? 'title s-idle' : 'title', row.title),
      el('span', 'age', row.age)
    );
    return node;
  }

  const BUILDERS = {
    rail: buildRail,
    duration: buildDuration,
    ledger: buildLedger,
    pulse: buildPulse,
  };

  function ageText(row, state) {
    // The reason matters more than the clock right up until it has been a
    // while, at which point how long is the more useful of the two.
    return state === 'waiting' ? row.waitingFor + ' · ' + row.age : row.age;
  }

  function baseRow(row, state) {
    const node = el('div', 'row');
    node.dataset.state = state;
    node.dataset.id = row.id;
    node.setAttribute('role', 'listitem');
    node.setAttribute('tabindex', '0');
    node.title = row.title + '\n' + row.name + ' · ' + row.project + '\n' + row.age;
    return node;
  }

  function buildHeadline(row) {
    const card = el('div', 'headline');
    card.dataset.id = row.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.append(
      el('div', 'headline-eyebrow', 'Needs you · ' + row.age),
      el('div', 'headline-title', row.title),
      el('div', 'headline-why', row.waitingFor + ' in ' + row.project),
      el('span', 'headline-btn', 'Go to chat')
    );
    return card;
  }

  // ---------- render ----------

  function render(state) {
    root.textContent = '';
    root.className = state.rowStyle;

    if (state.error) {
      root.append(el('div', 'error', state.error));
      return;
    }

    let rows = state.rows.slice().sort((a, b) => {
      const byState = ORDER[stateOf(a)] - ORDER[stateOf(b)];
      return byState !== 0 ? byState : b.weight - a.weight;
    });

    if (!state.showIdle) {
      rows = rows.filter((r) => stateOf(r) !== 'idle');
    }

    if (rows.length === 0) {
      root.append(el('div', 'empty', 'No Claude sessions running.'));
      return;
    }

    let listed = rows;

    if (state.headline) {
      const blocked = rows.filter((r) => stateOf(r) === 'waiting');
      for (const row of blocked) {
        root.append(buildHeadline(row));
      }
      listed = rows.filter((r) => stateOf(r) !== 'waiting');
      if (blocked.length > 0 && listed.length > 0) {
        root.append(el('div', 'strip-label', listed.length + ' other' + (listed.length === 1 ? '' : 's')));
      }
    }

    if (state.rowStyle === 'ledger' && listed.length > 0) {
      const head = el('div', 'lhead');
      head.append(el('span', '', ''), el('span', '', 'Session'), el('span', '', 'Proj'), el('span', 'age', 'Age'));
      root.append(head);
    }

    for (const row of listed) {
      root.append(BUILDERS[state.rowStyle](row, stateOf(row)));
    }
  }

  // ---------- interaction ----------

  function rowIdFrom(target) {
    const node = target instanceof Element ? target.closest('[data-id]') : null;
    return node instanceof HTMLElement ? node.dataset.id : undefined;
  }

  root.addEventListener('click', (event) => {
    const id = rowIdFrom(event.target);
    if (id) send('reveal', id);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const id = rowIdFrom(event.target);
    if (!id) return;
    event.preventDefault();
    send('reveal', id);
  });

  root.addEventListener('contextmenu', (event) => {
    const id = rowIdFrom(event.target);
    if (!id) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, id);
  });

  function openMenu(x, y, id) {
    menu.textContent = '';
    for (const [label, type] of [
      ['Go to chat', 'reveal'],
      ['Open transcript', 'transcript'],
      ['Copy session ID', 'copyId'],
    ]) {
      const button = el('button', '', label);
      button.addEventListener('click', () => {
        closeMenu();
        send(type, id);
      });
      menu.append(button);
    }
    menu.hidden = false;
    // Place after unhiding so the measured size is real, and keep it on screen.
    const box = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - box.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - box.height - 4) + 'px';
    const first = menu.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  }

  function closeMenu() {
    menu.hidden = true;
  }

  document.addEventListener('click', (event) => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'render') render(event.data);
  });

  send('ready');
})();
