(function () {
  'use strict';

  // ==========================================
  // 1. UTILIDADES COMPARTIDAS
  // ==========================================
  function formatMoney(n) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  // ==========================================
  // 2. LÓGICA: PORTFOLIO STRESS TEST
  // ==========================================
  function initStressTest() {
    // Plugin for drawing a vertical line on hover (Crosshair effect)
    if (typeof Chart !== 'undefined') {
      const verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: chart => {
          if (chart.tooltip?._active?.length) {
            const x = chart.tooltip._active[0].element.x;
            const yAxis = chart.scales.y;
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, yAxis.top);
            ctx.lineTo(x, yAxis.bottom);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.stroke();
            ctx.restore();
          }
        }
      };
      Chart.register(verticalLinePlugin);
    }

    const WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/27031091/uv8yq4a/';
    const ASSET_KEYS = ['cash', 'bonds', 'stocks', 'real-estate', 'crypto', 'gold', 'other'];
    const INITIAL_ALLOC = { cash: 10, bonds: 20, stocks: 40, 'real-estate': 15, crypto: 5, gold: 5, other: 5 };

    const RISK_INFO = {
      "Inflation": { desc: "Vulnerability to a sustained period of rising consumer prices and currency debasement.", note: "Consider increasing allocation to hard assets (gold, real estate, commodities) or Bitcoin to protect purchasing power." },
      "Concentration": { desc: "Over-reliance on a single asset class or geographic region.", note: "Diversify into non-correlated asset classes to reduce single-point-of-failure risk." },
      "Low Growth": { desc: "Risk of portfolio not outpacing inflation or meeting retirement goals due to low yields.", note: "Allocate more towards equities or growth-focused assets." },
      "Systemic": { desc: "Exposure to broad market crashes and standard financial system failures.", note: "Ensure adequate non-correlated asymmetric hedges." },
      "Deflation Shock": { desc: "Vulnerability to a liquidity crisis, credit contraction, or severe economic slowdown.", note: "Ensure adequate cash reserves or high-quality government bonds to provide optionality during a crash." },
      "Income": { desc: "High dependency on active work. Income is a large percent of net worth.", note: "Build passive income streams and increase emergency reserves to reduce dependency on active income." }
    };

    const STATE = {
      goal: '', concern: '', concernOther: '',
      name: '', email: '',
      netWorth: 0, freedomNetWorth: 0, annualIncome: 0, monthlySavings: 0, currentReturn: 0, currentAge: 0, retirementAge: 0,
      allocation: { ...INITIAL_ALLOC },
      behavioral: {},
      stage: null, stageLabel: '', riskScores: null, overallRisk: null, criticalCount: 0,
      currentStep: 1, totalSteps: 8, _charts: {},
    };

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
    const getInput = (key) => $(`[data-input="${key}"]`);
    const getSlider = (key) => $(`[data-slider="${key}"]`);
    const getDisplay = (key) => $(`[data-display="${key}"]`);
    const getResult = (key) => $(`[data-result="${key}"]`);
    const getChart = (key) => $(`[data-chart="${key}"]`);
    const getStepEl = (n) => $(`[data-step="${n}"]`);
    const getPip = (n) => $(`[data-pip="${n}"]`);

    function goToStep(next) {
      if (next < 1 || next > STATE.totalSteps) return;
      getStepEl(STATE.currentStep)?.classList.remove('active');
      getStepEl(next).classList.add('active');
      STATE.currentStep = next;

      for (let i = 1; i <= STATE.totalSteps; i++) {
        getPip(i)?.classList.toggle('active', i <= STATE.currentStep);
      }

      if (next === STATE.totalSteps) {
        computeResults();
        renderResults();
        renderRiskCards();
        renderCharts();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const validators = {
      1: () => {
        const g = document.querySelector('input[name="goal"]:checked');
        if (!g) { $('[data-error="goal"]').classList.add('visible'); return false; }
        $('[data-error="goal"]').classList.remove('visible');
        STATE.goal = g.value; return true;
      },
      2: () => {
        const c = document.querySelector('input[name="concern"]:checked');
        if (!c) { $('[data-error="concern"]').classList.add('visible'); return false; }
        $('[data-error="concern"]').classList.remove('visible');
        STATE.concern = c.value;
        STATE.concernOther = c.value === 'Other' ? getInput('concern-other').value : '';
        return true;
      },
      3: () => validateFields(['net-worth', 'freedom-net-worth', 'annual-income', 'monthly-savings', 'current-return'], {
        'net-worth': v => v !== '' && Number(v) >= 0,
        'freedom-net-worth': v => v !== '' && Number(v) >= 0,
        'annual-income': v => v !== '' && Number(v) >= 0,
        'monthly-savings': v => v !== '' && Number(v) >= 0,
        'current-return': v => v !== '' && Number(v) >= 0 && Number(v) <= 100
      }, () => {
        STATE.netWorth = parseFloat(getInput('net-worth').value);
        STATE.freedomNetWorth = parseFloat(getInput('freedom-net-worth').value);
        STATE.annualIncome = parseFloat(getInput('annual-income').value);
        STATE.monthlySavings = parseFloat(getInput('monthly-savings').value);
        STATE.currentReturn = parseFloat(getInput('current-return').value);
      }),
      4: () => validateFields(['current-age', 'retirement-age'], {
        'current-age': v => v !== '' && Number(v) >= 18,
        'retirement-age': v => v !== '' && Number(v) > Number(getInput('current-age').value)
      }, () => {
        STATE.currentAge = parseFloat(getInput('current-age').value);
        STATE.retirementAge = parseFloat(getInput('retirement-age').value);
      }),
      5: () => Math.round(ASSET_KEYS.reduce((s, k) => s + (STATE.allocation[k] ?? 0), 0)) === 100,
      6: () => validateFields(['beh-acc-drop', 'beh-ind-drop', 'beh-acc-grow', 'beh-ind-grow'], {
        'beh-acc-drop': v => v !== '', 'beh-ind-drop': v => v !== '',
        'beh-acc-grow': v => v !== '', 'beh-ind-grow': v => v !== ''
      }, () => {
        STATE.behavioral = {
          accDrop: getInput('beh-acc-drop').value, indDrop: getInput('beh-ind-drop').value,
          accGrow: getInput('beh-acc-grow').value, indGrow: getInput('beh-ind-grow').value
        };
      }),
      7: () => validateFields(['name', 'email'], {
        'name': v => v.trim().length > 1,
        'email': v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
      }, () => {
        STATE.name = getInput('name').value.trim();
        STATE.email = getInput('email').value.trim();
      })
    };

    function validateFields(keys, tests, onSuccess) {
      let ok = true;
      keys.forEach(key => {
        const el = getInput(key);
        const err = $(`[data-error="${key}"]`);
        const pass = tests[key](el?.value ?? '');
        el?.classList.toggle('error', !pass);
        err?.classList.toggle('visible', !pass);
        if (!pass) ok = false;
      });
      if (ok) onSuccess();
      return ok;
    }

    function initUI() {
      document.querySelectorAll('.radio-card input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          const name = e.target.name;
          document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.closest('.radio-card').classList.remove('selected'));
          e.target.closest('.radio-card').classList.add('selected');

          if (name === 'concern') {
            const wrapper = document.getElementById('concern-other-wrapper');
            wrapper.style.display = e.target.value === 'Other' ? 'block' : 'none';
          }
        });
      });

      document.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const act = btn.dataset.action;

        if (act === 'next' && (!validators[STATE.currentStep] || validators[STATE.currentStep]())) {
          goToStep(STATE.currentStep + 1);
        } else if (act === 'prev') {
          goToStep(STATE.currentStep - 1);
        } else if (act === 'restart' || act === 'fix-email') {
          $('[data-element="results-dashboard"]').style.display = 'block';
          $('[data-element="success-screen"]').style.display = 'none';
          const status = $('[data-element="submit-status"]');
          if (status) { status.style.display = 'none'; status.className = 'submit-status'; }
          $('[data-action="submit-plan"]').disabled = false;
          goToStep(act === 'restart' ? 1 : 7);
        }
      });

      const ca = getInput('current-age'), ra = getInput('retirement-age'), display = getDisplay('years-left');
      const updateYears = () => {
        const c = parseInt(ca.value) || 0; const r = parseInt(ra.value) || 0;
        if (r > c && c > 0) { display.textContent = `${r - c} years left until retirement`; display.style.display = 'block'; } 
        else display.style.display = 'none';
      };
      ca?.addEventListener('input', updateYears);
      ra?.addEventListener('input', updateYears);
    }

    function initSliders() {
      ASSET_KEYS.forEach(key => {
        const s = getSlider(key);
        if (!s) return;
        s.value = INITIAL_ALLOC[key] ?? 0;
        getDisplay(`value-${key}`).textContent = `${Math.round(s.value)}%`;
        s.addEventListener('input', () => handleSlider(key, parseFloat(s.value)));
      });
    }

    function handleSlider(changedKey, newVal) {
      newVal = Math.min(100, Math.max(0, newVal));
      STATE.allocation[changedKey] = newVal;
      const others = ASSET_KEYS.filter(k => k !== changedKey);
      const rem = 100 - newVal;
      const othersSum = others.reduce((s, k) => s + (STATE.allocation[k] ?? 0), 0);

      if (othersSum === 0) others.forEach(k => STATE.allocation[k] = parseFloat((rem / others.length).toFixed(1)));
      else others.forEach(k => STATE.allocation[k] = parseFloat(((STATE.allocation[k] / othersSum) * rem).toFixed(1)));

      const total = ASSET_KEYS.reduce((s, k) => s + STATE.allocation[k], 0);
      const diff = parseFloat((100 - total).toFixed(1));
      if (diff !== 0) {
        const target = others.reduce((a, b) => STATE.allocation[a] > STATE.allocation[b] ? a : b);
        STATE.allocation[target] = parseFloat((STATE.allocation[target] + diff).toFixed(1));
      }

      ASSET_KEYS.forEach(k => {
        const s = getSlider(k);
        if (s && k !== changedKey) s.value = STATE.allocation[k];
        getDisplay(`value-${k}`).textContent = `${Math.round(STATE.allocation[k])}%`;
      });

      const tEl = getDisplay('allocation-total');
      tEl.textContent = `100%`; tEl.className = 'ok';
    }

    function computeResults() {
      const t = [
        { max: 10_000, l: 'Foundation (Debt & Income)' },
        { max: 100_000, l: 'Accumulation (Building Portfolio)' },
        { max: 1_000_000, l: 'Aggressive Growth' },
        { max: Infinity, l: 'Preservation & Legacy' }
      ];
      let st = 1;
      for (let i = 0; i < t.length; i++) { if (STATE.netWorth < t[i].max) { st = i + 1; break; } st = i + 1; }
      const nextThresh = [10_000, 100_000, 1_000_000, 10_000_000][st - 1];
      if (st < 4 && STATE.annualIncome > nextThresh * 0.10) st = Math.min(4, st + 1);

      STATE.stage = st; STATE.stageLabel = t[st - 1].l;
      const a = STATE.allocation;
      
      STATE.riskScores = {
        "Inflation": Math.round(Math.min(100, (a.cash * 2) + (a.bonds * 0.5))),
        "Concentration": Math.round(Math.min(100, Math.max(...ASSET_KEYS.map(k => a[k])) * 1.4)),
        "Low Growth": Math.round(Math.max(0, Math.min(100, (10 - STATE.currentReturn) * 8 + (a.cash + a.bonds) * 0.5))),
        "Systemic": Math.round(Math.min(100, (a.stocks * 0.7) + (a.crypto * 1.5))),
        "Deflation Shock": Math.round(Math.max(0, 80 - (a['real-estate'] + a.bonds + a.gold) * 0.8)),
        "Income": Math.round(Math.min(100, Math.max(0, 60 - ((STATE.netWorth > 0 ? (STATE.annualIncome / STATE.netWorth) * 100 : 50)) * 1.5)))
      };

      let criticals = 0; let totalScore = 0;
      for (const val of Object.values(STATE.riskScores)) { totalScore += val; if (val >= 80) criticals++; }
      STATE.overallRisk = Math.round(totalScore / 6); STATE.criticalCount = criticals;
    }

    function renderResults() {
      getResult('name-title').textContent = STATE.name.split(' ')[0] ? STATE.name.split(' ')[0].toUpperCase() : "YOUR";
      getResult('stage').textContent = STATE.stage;
      getResult('stage-desc').textContent = STATE.stageLabel;
      getResult('overall-risk').textContent = STATE.overallRisk;
      getResult('target-wealth').textContent = '$' + Math.round(STATE.freedomNetWorth).toLocaleString();
      const critEl = getResult('critical-count');
      if (STATE.criticalCount > 0) { critEl.textContent = `⚠ ${STATE.criticalCount} Critical Vulnerabilities`; critEl.style.display = 'inline-block'; } 
      else critEl.style.display = 'none';
    }

    function renderRiskCards() {
      const container = document.getElementById('risk-cards-container');
      if (!container) return;
      container.innerHTML = '';
      for (const [riskName, score] of Object.entries(STATE.riskScores)) {
        let cls, txt;
        if (score < 35) { cls = 'risk-low'; txt = `Low (${score})`; }
        else if (score < 65) { cls = 'risk-medium'; txt = `Moderate (${score})`; }
        else { cls = 'risk-high'; txt = `Critical (${score})`; }
        const info = RISK_INFO[riskName] || { desc: '', note: '' };
        container.innerHTML += `
          <div class="risk-card-item">
             <div class="risk-card-header"><div class="risk-card-title">${riskName} Risk</div><div class="risk-badge ${cls}" style="font-size:0.65rem; padding: 2px 6px;">${txt}</div></div>
             <div class="risk-desc">${info.desc}</div>
             <div class="heresy-note">> Heresy Note: ${info.note}</div>
          </div>`;
      }
    }

    function destroyChart(key) { if (STATE._charts[key]) { STATE._charts[key].destroy(); delete STATE._charts[key]; } }

    function renderCharts() {
      destroyChart('radar');
      STATE._charts['radar'] = new Chart(getChart('radar'), {
        type: 'radar',
        data: { labels: Object.keys(STATE.riskScores), datasets: [{ data: Object.values(STATE.riskScores), backgroundColor: 'rgba(245,197,24,0.3)', borderColor: '#f5c518', pointBackgroundColor: '#f5c518', borderWidth: 2, fill: true }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 33.33 }, grid: { color: 'rgba(255,255,255,0.15)', lineWidth: 1 }, angleLines: { color: 'rgba(255,255,255,0.15)', lineWidth: 1 }, pointLabels: { color: '#e8eaf0', font: { family: "'DM Mono'", size: 14 } } } } }
      });
      // (Lines charts omitted for brevity here but keeping the structure)
    }

    function initWebhook() {
      document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action="submit-plan"]');
        if (!btn) return;
        const status = $('[data-element="submit-status"]');
        btn.disabled = true; status.style.display = 'block'; status.className = 'submit-status loading'; status.textContent = '⏳ Calculating your roadmap...';
        try {
          const res = await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(STATE) });
          if (res.ok || res.type === 'opaque') {
            $('[data-element="results-dashboard"]').style.display = 'none';
            $('[data-element="success-screen"]').style.display = 'block';
            $('[data-display="sent-email"]').textContent = STATE.email;
          } else throw new Error();
        } catch (err) {
          status.className = 'submit-status fail'; status.textContent = '❌ Error. Please try again.'; btn.disabled = false;
        }
      });
    }
    
    initUI(); initSliders(); initWebhook();
  }

  // ==========================================
  // 3. LÓGICA: INTRINSIC VALUE CALCULATOR
  // ==========================================
  function initIntrinsicValue() {
    const IV_API_URL = "https://heresy-tools-api.onrender.com";

    function showIvError(msg) {
      const err = document.getElementById('iv-errorBanner');
      err.textContent = "❌ " + msg;
      err.classList.add('visible');
    }

    function hideIvError() {
      document.getElementById('iv-errorBanner').classList.remove('visible');
    }

    async function ivFetchStockData() {
      hideIvError();
      const ticker = document.getElementById('iv-tickerInput').value.trim().toUpperCase();
      if (!ticker) return alert("Please enter a stock symbol.");

      const btn = document.getElementById('iv-btnLoad');
      btn.textContent = "Loading..."; btn.disabled = true;

      try {
        const response = await fetch(`${IV_API_URL}/api/stock?symbol=${ticker}`);
        if (!response.ok) throw new Error("API Error");

        const data = await response.json();
        
        document.getElementById('iv-currentPrice').value = data.currentPrice || 0;
        document.getElementById('iv-epsTTM').value = data.epsTTM || 0;
        document.getElementById('iv-currentGrowth').value = data.currentGrowth || 0;
        document.getElementById('iv-targetPE').value = data.targetPE || 0;

        ivCalculate();
      } catch (error) {
        console.error(error);
        alert(`Could not load data for ${ticker}. Symbol may be invalid.`);
      } finally {
        btn.textContent = "Load Info"; btn.disabled = false;
      }
    }

    function ivCalculate() {
      hideIvError();

      const currentPrice = parseFloat(document.getElementById('iv-currentPrice').value);
      const epsTTM = parseFloat(document.getElementById('iv-epsTTM').value);
      const currentGrowth = parseFloat(document.getElementById('iv-currentGrowth').value) / 100;
      const desiredReturn = parseFloat(document.getElementById('iv-desiredReturn').value) / 100;
      const purchaseDiscount = parseFloat(document.getElementById('iv-purchaseDiscount').value) / 100;
      const targetPE = parseFloat(document.getElementById('iv-targetPE').value);

      if ([currentPrice, epsTTM, currentGrowth, desiredReturn, purchaseDiscount, targetPE].some(isNaN)) {
        return showIvError('Please fill in all fields with valid numbers.');
      }
      if (purchaseDiscount > 1) {
        return showIvError('Margin of safety cannot exceed 100%.');
      }

      const epsIn10 = epsTTM * Math.pow(1 + currentGrowth, 10);
      const price10 = epsIn10 * targetPE;
      const iv = price10 / Math.pow(1 + desiredReturn, 10);
      const entry = iv * purchaseDiscount;
      const mosPercent = Math.round((1 - purchaseDiscount) * 100);

      // Animate values
      const els = {
        'iv-r-eps10': epsIn10,
        'iv-r-price10': price10,
        'iv-r-iv': iv,
        'iv-r-entry': entry
      };

      for (const [id, val] of Object.entries(els)) {
        const el = document.getElementById(id);
        el.classList.remove('animated-value');
        void el.offsetWidth;
        el.textContent = formatMoney(val);
        el.classList.add('animated-value');
      }
      
      const rMarket = document.getElementById('iv-r-market');
      rMarket.textContent = formatMoney(currentPrice);

      // Color logic
      const compCard = document.getElementById('iv-card-comparison');
      const compMsg = document.getElementById('iv-comparison-msg');
      compCard.classList.remove('green-accent', 'red-accent');

      if (currentPrice <= entry && currentPrice > 0) {
        compCard.classList.add('green-accent');
        rMarket.style.color = 'var(--green)';
        compMsg.textContent = "✅ Actionable: Current price is below your max entry price.";
        compMsg.style.color = 'var(--green)';
      } else {
        compCard.classList.add('red-accent');
        rMarket.style.color = 'var(--red)';
        compMsg.textContent = "❌ Too Expensive: Current price is above your max entry price.";
        compMsg.style.color = 'var(--red)';
      }

      // Margin of Safety Badge
      const badge = document.getElementById('iv-marginBadge');
      const badgeText = document.getElementById('iv-marginText');
      badge.className = 'margin-badge';
      badge.style.display = 'inline-flex';
      
      if (mosPercent >= 25) { badge.classList.add('safe'); badgeText.textContent = `${mosPercent}% margin of safety — Strong protection`; }
      else if (mosPercent >= 10) { badge.classList.add('caution'); badgeText.textContent = `${mosPercent}% margin of safety — Moderate buffer`; }
      else { badge.classList.add('danger'); badgeText.textContent = `${mosPercent}% margin of safety — Thin cushion`; }

      // Force Webflow visibility
      const resultsSec = document.getElementById('iv-resultsSection');
      resultsSec.style.cssText = "display: block !important; opacity: 1 !important;";
      resultsSec.classList.add('visible');

      setTimeout(() => { resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
    }

    // Event Bindings
    const btnLoad = document.getElementById('iv-btnLoad');
    if (btnLoad) btnLoad.addEventListener('click', (e) => { e.preventDefault(); ivFetchStockData(); });

    const btnCalc = document.getElementById('iv-btnCalculate');
    if (btnCalc) btnCalc.addEventListener('click', (e) => { e.preventDefault(); ivCalculate(); });

    const btnModalOpen = document.getElementById('iv-btnModal');
    if (btnModalOpen) btnModalOpen.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('iv-mathModal').classList.add('active'); });

    const btnModalClose = document.getElementById('iv-closeModal');
    if (btnModalClose) btnModalClose.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('iv-mathModal').classList.remove('active'); });
  }

  // ==========================================
  // 4. INICIALIZADOR PRINCIPAL (ENRUTADOR)
  // ==========================================
  function initApp() {
    // Si la página tiene la pista de progreso, es el Portfolio Stress Test
    if (document.querySelector('.progress-track')) {
      initStressTest();
    }
    
    // Si la página tiene el input de ticker de Intrinsic Value, lo inicializamos
    if (document.getElementById('iv-tickerInput')) {
      initIntrinsicValue();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
