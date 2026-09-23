/* Считалка — калькулятор заказа.

   Каталог приходит зашифрованным (catalog.enc) и открывается паролем: пароль спрашивают
   один раз, дальше в localStorage лежит производный ключ. В localStorage также хранится
   текущий заказ (количества по артикулам) и выбранный тариф.

   Файл делится на две части:
     window.SCHITALKA_CALC — чистые функции (money, totals, migrateState). Не трогают DOM,
                             проверяются scripts/test_calc.py в движке jsc;
     интерфейс             — запускается только при наличии document.
   Все цены — целые копейки. */

(function () {
  'use strict';

  var K_QTY     = 'schitalka.qty.v1';
  var K_PERCENT = 'schitalka.percent.v1';
  var K_KEY     = 'schitalka.key.v1';
  var CATALOG   = 'catalog.enc';

  // ============================ чистые функции ============================

  function num(v) { v = parseFloat(v); return isNaN(v) ? 0 : v; }

  // 200507 → «2 005,07 ₽»; копейки показываются всегда.
  function money(kopecks) {
    var sign = kopecks < 0 ? '−' : '';
    var abs = Math.abs(Math.round(kopecks));
    var rub = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var kop = String(abs % 100);
    if (kop.length < 2) kop = '0' + kop;
    return sign + rub + ',' + kop + ' ₽';
  }

  function vpFmt(v) { return (Math.round(num(v) * 100) / 100).toFixed(2); }

  // Название для показа — где строку рвать нельзя:
  //   «N-R-G»        → неразрывный дефис U+2011 внутри слова;
  //   «Формула 1»    → неразрывный пробел между словом и числом;
  //   «2 кг», «14 шт» → неразрывный пробел между числом и единицей;
  //   « - »          → неразрывный пробел перед тире, чтобы оно не начинало строку.
  function displayName(name) {
    return String(name || '')
      .replace(/([0-9A-Za-zА-Яа-яЁё])-(?=[0-9A-Za-zА-Яа-яЁё])/g, '$1\u2011')
      .replace(/([A-Za-zА-Яа-яЁё]) (?=\d)/g, '$1\u00a0')
      .replace(/(\d) (?=(?:кг|г|мл|шт)(?![A-Za-zА-Яа-яЁё]))/g, '$1\u00a0')
      .replace(/ - /g, '\u00a0- ');
  }

  // Ключ позиции в сохранённом заказе.
  function keyOf(product) { return 'a:' + product.art; }

  // Цена позиции при тарифе, в копейках (null — если тарифа у позиции нет).
  function priceAt(product, percent) {
    var v = (product.prices || {})[String(percent)];
    return v == null ? null : v;
  }

  // Итоги заказа: сумма в копейках и VP. Складываем целыми, чтобы не копить ошибку дробей.
  function totals(catalog, qty, percent) {
    var sum = 0, vpHundredths = 0;
    (catalog || []).forEach(function (p) {
      var q = (qty || {})[keyOf(p)] || 0;
      if (q <= 0) return;
      var price = priceAt(p, percent);
      sum += (price == null ? 0 : price) * q;
      vpHundredths += Math.round(num(p.vp) * 100) * q;
    });
    return { sum: sum, vp: vpHundredths / 100 };
  }

  // Сколько позиций набрано (для нижней панели и чека).
  function countItems(catalog, qty) {
    var n = 0;
    (catalog || []).forEach(function (p) { if (((qty || {})[keyOf(p)] || 0) > 0) n++; });
    return n;
  }

  // Перенос сохранённого состояния на текущий каталог: неизвестный тариф → по умолчанию,
  // ушедшие артикулы и позиции без артикула (прежние доставки, ключи n:…) отбрасываются.
  function migrateState(state, catalog, percents, defaultPercent) {
    percents = percents || [0, 25, 35, 42, 50];
    defaultPercent = defaultPercent == null ? percents[0] : defaultPercent;
    state = state || {};
    var known = {};
    (catalog || []).forEach(function (p) { if (p.art) known[keyOf(p)] = true; });
    var qty = {};
    var source = state.qty || {};
    Object.keys(source).forEach(function (k) {
      var q = Math.floor(num(source[k]));
      if (known[k] && q > 0) qty[k] = q;
    });
    var percent = num(state.percent);
    if (percents.indexOf(percent) === -1) percent = defaultPercent;
    return { percent: percent, qty: qty };
  }

  window.SCHITALKA_CALC = {
    money: money, vpFmt: vpFmt, displayName: displayName, keyOf: keyOf, priceAt: priceAt,
    totals: totals, countItems: countItems, migrateState: migrateState
  };

  // ============================== интерфейс ===============================

  if (typeof document === 'undefined') return;

  var data = { percents: [0, 25, 35, 42, 50], defaultPercent: 0, products: [] };
  var products = [];
  var qty = {};
  var percent = 0;
  var query = '';

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function load(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  // ---- пароль и расшифровка каталога ----
  function b64ToBytes(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var bin = '';
    new Uint8Array(bytes).forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function deriveKey(password, blob) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2',
                                   false, ['deriveBits'])
      .then(function (material) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(blob.salt), iterations: blob.iter },
          material, 256);
      });
  }

  function decryptWith(rawKey, blob) {
    return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.nonce) },
                                     key, b64ToBytes(blob.ct));
      })
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  function fetchBlob() {
    return fetch(CATALOG, { cache: 'no-store' })
      .catch(function () { return fetch(CATALOG); })
      .then(function (r) {
        if (!r.ok) throw new Error('catalog.enc: ' + r.status);
        return r.json();
      });
  }

  function storedKey() {
    var rec = load(K_KEY, null);
    if (!rec || !rec.key) return null;
    return rec;
  }

  function rememberKey(rawKey, blob) {
    save(K_KEY, { kdf: 'PBKDF2-SHA256', iter: blob.iter, salt: blob.salt,
                  key: bytesToB64(rawKey) });
  }

  function forgetKey() { try { localStorage.removeItem(K_KEY); } catch (e) {} }

  function showGate(message) {
    $('#gate').classList.add('open');
    $('#gateError').textContent = message || '';
    $('#password').value = '';
    $('#password').focus();
  }

  function hideGate() { $('#gate').classList.remove('open'); }

  function startApp(catalog) {
    data = catalog;
    products = (Array.isArray(data.products) ? data.products : []).map(function (p) {
      return {
        key: keyOf(p), name: String(p.name || ''), art: String(p.art || ''),
        img: String(p.img || ''), vp: num(p.vp), prices: p.prices || {}
      };
    });
    var migrated = migrateState({ percent: load(K_PERCENT, data.defaultPercent), qty: load(K_QTY, {}) },
                                products, data.percents, data.defaultPercent);
    percent = migrated.percent;
    qty = migrated.qty;
    save(K_PERCENT, percent);
    save(K_QTY, qty);
    hideGate();
    renderPercent();
    renderList();
    renderTotals();
  }

  function openCatalog() {
    fetchBlob().then(function (blob) {
      var rec = storedKey();
      if (!rec) { showGate(''); return; }
      return decryptWith(b64ToBytes(rec.key), blob)
        .then(startApp)
        .catch(function () { forgetKey(); showGate(''); });   // ключ не подходит — молча забываем
    }).catch(function (e) {
      showGate('Каталог не загрузился: ' + e.message);
    });
  }

  function submitPassword() {
    var password = $('#password').value;
    if (!password) return;
    $('#gateError').textContent = 'Открываю…';
    fetchBlob().then(function (blob) {
      return deriveKey(password, blob).then(function (rawKey) {
        return decryptWith(rawKey, blob).then(function (catalog) {
          rememberKey(rawKey, blob);
          startApp(catalog);
        });
      });
    }).catch(function () {
      showGate('Пароль не подошёл');
    });
  }

  // ---- тариф ----
  function renderPercent() {
    var sel = $('#percent');
    sel.innerHTML = '';
    (data.percents || []).forEach(function (pc) {
      var o = document.createElement('option');
      o.value = pc; o.textContent = pc + '%';
      if (pc === percent) o.selected = true;
      sel.appendChild(o);
    });
  }

  // ---- список ----
  function visible() {
    if (!query) return products;
    var q = query.toLowerCase();
    return products.filter(function (p) {
      return p.name.toLowerCase().indexOf(q) !== -1 || p.art.toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderList() {
    var list = $('#list');
    var items = visible();
    if (!products.length) { list.innerHTML = '<div class="empty">Каталог пуст.</div>'; return; }
    if (!items.length) {
      list.innerHTML = '<div class="empty">Ничего не найдено по запросу «' + esc(query) + '».</div>';
      return;
    }
    list.innerHTML = items.map(function (p) {
      var q = qty[p.key] || 0;
      var price = priceAt(p, percent);
      // артикул и VP — отдельными строками, без разделителя
      var meta = '<div>Арт: ' + esc(p.art) + '</div>' + (p.vp ? '<div>' + vpFmt(p.vp) + ' vp</div>' : '');
      var unitHtml = (price == null)
        ? '<div class="unit none">нет цены по тарифу</div>'
        : '<div class="unit">' + money(price) + '/шт</div>';
      var thumb = p.img
        ? '<img class="thumb" src="img/' + esc(p.img) + '" alt="" loading="lazy">'
        : '<div class="thumb"></div>';
      return '' +
        '<div class="item' + (q > 0 ? ' active' : '') + '" data-key="' + esc(p.key) + '">' +
          thumb +
          '<div class="info">' +
            '<div class="name">' + esc(displayName(p.name)) + '</div>' +
            '<div class="meta">' + meta + '</div>' +
            // цена и кнопки — одной строкой под названием: название получает всю ширину
            '<div class="row">' + unitHtml +
              '<div class="stepper"><div class="btns">' +
                '<button class="step minus" aria-label="−">−</button>' +
                '<span class="qty">' + q + '</span>' +
                '<button class="step plus" aria-label="+">+</button>' +
              '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function changeQty(key, delta) {
    var q = (qty[key] || 0) + delta;
    if (q < 0) q = 0;
    if (q === 0) delete qty[key]; else qty[key] = q;
    save(K_QTY, qty);
    var row = document.querySelector('.item[data-key="' +
      (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (row) { row.querySelector('.qty').textContent = q; row.classList.toggle('active', q > 0); }
    renderTotals();
  }

  // ---- итоги ----
  function renderTotals() {
    var t = totals(products, qty, percent);
    $('#total').textContent = money(t.sum);
    $('#totalVp').textContent = vpFmt(t.vp);
    $('#count').textContent = countItems(products, qty);
  }

  // ---- чек ----
  function buildReceipt() {
    var t = totals(products, qty, percent);
    var lines = ['Ваш чек:', ''];
    products.forEach(function (p) {
      var q = qty[p.key] || 0;
      if (q <= 0) return;
      var price = priceAt(p, percent);
      var extra = ['Арт: ' + p.art];
      if (p.vp) extra.push(vpFmt(p.vp * q) + ' vp');
      extra.push(q + ' шт');
      extra.push(money((price == null ? 0 : price) * q));
      lines.push(p.name + '\n  ' + extra.join(' · '));
    });
    lines.push('');
    lines.push('Позиций: ' + countItems(products, qty));
    lines.push('Тариф: ' + percent + ' %');
    if (t.vp) lines.push('VP: ' + vpFmt(t.vp));
    lines.push('Итого: ' + money(t.sum));
    return lines.join('\n');
  }

  function showReceipt() {
    if (countItems(products, qty) === 0) { alert('Добавьте хотя бы один товар в заказ.'); return; }
    $('#receiptText').textContent = buildReceipt();
    $('#receiptOverlay').classList.add('open');
  }

  function copyReceipt() {
    var text = $('#receiptText').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { alert('Чек скопирован'); },
                                               function () { fallbackCopy(text); });
    } else { fallbackCopy(text); }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); alert('Чек скопирован'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function clearOrder() {
    if (countItems(products, qty) === 0) return;
    if (!confirm('Очистить заказ?')) return;
    qty = {}; save(K_QTY, qty); renderList(); renderTotals();
    $('#receiptOverlay').classList.remove('open');
  }

  // ---- события ----
  function bind() {
    $('#gateForm').addEventListener('submit', function (e) { e.preventDefault(); submitPassword(); });
    $('#list').addEventListener('click', function (e) {
      var btn = e.target.closest('.step'); if (!btn) return;
      var key = btn.closest('.item').getAttribute('data-key');
      changeQty(key, btn.classList.contains('plus') ? 1 : -1);
    });
    $('#percent').addEventListener('change', function () {
      percent = num(this.value); save(K_PERCENT, percent); renderList(); renderTotals();
    });
    var s = $('#search');
    s.addEventListener('input', function () { query = this.value.trim(); renderList(); });
    $('#btnClearSearch').addEventListener('click', function () {
      s.value = ''; query = ''; renderList(); s.focus();
    });
    $('#btnReceipt').addEventListener('click', showReceipt);
    $('#totalBox').addEventListener('click', showReceipt);
    $('#btnCopy').addEventListener('click', copyReceipt);
    $('#btnClear').addEventListener('click', clearOrder);
    $('#btnCloseReceipt').addEventListener('click', function () {
      $('#receiptOverlay').classList.remove('open');
    });
    $('#receiptOverlay').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  }

  function start() { bind(); openCatalog(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
