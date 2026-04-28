
(function () {
  'use strict';

  // Plugin for drawing a vertical line on hover (Crosshair effect)
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

  const WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/27031091/uj0ajne/';
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

    // Dashboard Step
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
      STATE.goal = g.value;
      return true;
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
        accDrop: getInput('beh-acc-drop').value,
        indDrop: getInput('beh-ind-drop').value,
        accGrow: getInput('beh-acc-grow').value,
        indGrow: getInput('beh-ind-grow').value
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
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
          r.closest('.radio-card').classList.remove('selected');
        });
        e.target.closest('.radio-card').classList.add('selected');

        if (name === 'concern') {
          const wrapper = document.getElementById('concern-other-wrapper');
          if (e.target.value === 'Other') wrapper.style.display = 'block';
          else wrapper.style.display = 'none';
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
      } else if (act === 'restart') {
        $('[data-element="results-dashboard"]').style.display = 'block';
        $('[data-element="success-screen"]').style.display = 'none';
        const status = $('[data-element="submit-status"]');
        if (status) { status.style.display = 'none'; status.className = 'submit-status'; }
        $('[data-action="submit-plan"]').disabled = false;
        goToStep(1);
      } else if (act === 'fix-email') {
        $('[data-element="results-dashboard"]').style.display = 'block';
        $('[data-element="success-screen"]').style.display = 'none';
        const status = $('[data-element="submit-status"]');
        if (status) { status.style.display = 'none'; status.className = 'submit-status'; }
        $('[data-action="submit-plan"]').disabled = false;
        goToStep(7);
      }
    });

    const ca = getInput('current-age');
    const ra = getInput('retirement-age');
    const display = getDisplay('years-left');
    const updateYears = () => {
      const c = parseInt(ca.value) || 0; const r = parseInt(ra.value) || 0;
      if (r > c && c > 0) {
        display.textContent = `${r - c} years left until retirement`;
        display.style.display = 'block';
      } else { display.style.display = 'none'; }
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

    if (othersSum === 0) {
      others.forEach(k => STATE.allocation[k] = parseFloat((rem / others.length).toFixed(1)));
    } else {
      others.forEach(k => STATE.allocation[k] = parseFloat(((STATE.allocation[k] / othersSum) * rem).toFixed(1)));
    }

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
    tEl.textContent = `100%`;
    tEl.className = 'ok';
  }

  function computeResults() {
    const t = [
      { max: 10_000, l: 'Foundation (Debt & Income)' },
      { max: 100_000, l: 'Accumulation (Building Portfolio)' },
      { max: 1_000_000, l: 'Aggressive Growth' },
      { max: Infinity, l: 'Preservation & Legacy' }
    ];
    let st = 1;
    for (let i = 0; i < t.length; i++) {
      if (STATE.netWorth < t[i].max) { st = i + 1; break; }
      st = i + 1;
    }
    const nextThresh = [10_000, 100_000, 1_000_000, 10_000_000][st - 1];
    if (st < 4 && STATE.annualIncome > nextThresh * 0.10) st = Math.min(4, st + 1);

    STATE.stage = st; STATE.stageLabel = t[st - 1].l;

    const a = STATE.allocation;
    const inflation = Math.min(100, (a.cash * 2) + (a.bonds * 0.5));
    const concentration = Math.min(100, Math.max(...ASSET_KEYS.map(k => a[k])) * 1.4);
    const lowGrowth = Math.max(0, Math.min(100, (10 - STATE.currentReturn) * 8 + (a.cash + a.bonds) * 0.5));
    const systemic = Math.min(100, (a.stocks * 0.7) + (a.crypto * 1.5));
    const deflation = Math.max(0, 80 - (a['real-estate'] + a.bonds + a.gold) * 0.8);
    const incRatio = STATE.netWorth > 0 ? (STATE.annualIncome / STATE.netWorth) * 100 : 50;
    const incomeR = Math.min(100, Math.max(0, 60 - incRatio * 1.5));

    const dims = { "Inflation": inflation, "Concentration": concentration, "Low Growth": lowGrowth, "Systemic": systemic, "Deflation Shock": deflation, "Income": incomeR };

    let criticals = 0; let totalScore = 0;
    for (const key in dims) {
      const rounded = Math.round(dims[key]);
      dims[key] = rounded;
      totalScore += rounded;
      if (rounded >= 80) criticals++;
    }

    STATE.riskScores = dims;
    STATE.overallRisk = Math.round(totalScore / 6);
    STATE.criticalCount = criticals;
  }

  function renderResults() {
    const firstName = STATE.name.split(' ')[0];
    getResult('name-title').textContent = firstName ? firstName.toUpperCase() : "YOUR";
    getResult('stage').textContent = STATE.stage;
    getResult('stage-desc').textContent = STATE.stageLabel;
    getResult('overall-risk').textContent = STATE.overallRisk;
    getResult('target-wealth').textContent = '$' + Math.round(STATE.freedomNetWorth).toLocaleString();

    const critEl = getResult('critical-count');
    if (STATE.criticalCount > 0) {
      critEl.textContent = `⚠ ${STATE.criticalCount} Critical Vulnerabilities`;
      critEl.style.display = 'inline-block';
    } else {
      critEl.style.display = 'none';
    }
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
           <div class="risk-card-header">
              <div class="risk-card-title">${riskName} Risk</div>
              <div class="risk-badge ${cls}" style="font-size:0.65rem; padding: 2px 6px;">${txt}</div>
           </div>
           <div class="risk-desc">${info.desc}</div>
           <div class="heresy-note">> Heresy Note: ${info.note}</div>
        </div>
      `;
    }
  }

  function destroyChart(key) {
    if (STATE._charts[key]) { STATE._charts[key].destroy(); delete STATE._charts[key]; }
  }

  function renderCharts() {
    destroyChart('radar');
    STATE._charts['radar'] = new Chart(getChart('radar'), {
      type: 'radar',
      data: {
        labels: Object.keys(STATE.riskScores),
        datasets: [{
          label: 'Vulnerability', data: Object.values(STATE.riskScores),
          backgroundColor: 'rgba(245,197,24,0.3)', borderColor: '#f5c518', pointBackgroundColor: '#f5c518', borderWidth: 2, fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { display: false, stepSize: 33.33 }, // Reduces the number of hexagons
            grid: { color: 'rgba(255,255,255,0.15)', lineWidth: 1 },
            angleLines: { color: 'rgba(255,255,255,0.15)', lineWidth: 1 },
            pointLabels: { color: '#e8eaf0', font: { family: "'DM Mono'", size: 14 } } // Larger labels
          }
        }
      }
    });

    function compoundAnnuityUntilTarget(principal, annualRate, monthlyContrib, target, startAge) {
      const data = [Math.round(principal)];
      const labels = [startAge];
      let balance = principal;
      const r = annualRate / 100;
      let y = 1;

      while (balance < target && y <= 60) {
        if (r === 0) { balance += (monthlyContrib * 12); }
        else {
          const monthlyRate = r / 12;
          balance = balance * Math.pow(1 + monthlyRate, 12) + monthlyContrib * ((Math.pow(1 + monthlyRate, 12) - 1) / monthlyRate);
        }
        data.push(Math.round(balance));
        labels.push(startAge + y);
        y++;
      }
      return { data, labels };
    }

    function compoundAnnuity(principal, annualRate, years, monthlyContrib) {
      const data = [Math.round(principal)];
      let balance = principal;
      const r = annualRate / 100;
      for (let y = 1; y <= years; y++) {
        if (r === 0) { balance += (monthlyContrib * 12); }
        else {
          const monthlyRate = r / 12;
          balance = balance * Math.pow(1 + monthlyRate, 12) + monthlyContrib * ((Math.pow(1 + monthlyRate, 12) - 1) / monthlyRate);
        }
        data.push(Math.round(balance));
      }
      return data;
    }

    const lineConfig = (label, colorHex, colorRgb, data, labels, canvasId) => {
      const canvas = getChart(canvasId);
      let bg = colorHex;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        bg = ctx.createLinearGradient(0, 0, 0, 300);
        bg.addColorStop(0, `rgba(${colorRgb}, 0.5)`);
        bg.addColorStop(1, `rgba(${colorRgb}, 0.0)`);
      }
      return {
        type: 'line',
        data: { labels, datasets: [{ label, data, borderColor: colorHex, backgroundColor: bg, fill: true, tension: 0.35, pointRadius: 0 }] },
        options: {
          responsive: true,
          interaction: {
            mode: 'index',
            intersect: false, // Allows crosshair tooltip to show anywhere on the vertical axis
          },
          plugins: {
            legend: { labels: { color: '#e8eaf0' } },
            tooltip: {
              backgroundColor: 'rgba(20, 25, 32, 0.95)',
              titleColor: '#e8eaf0',
              bodyColor: '#f5c518',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              displayColors: false,
              callbacks: {
                title: (ctx) => ctx[0].label,
                label: (ctx) => 'value : ' + Math.round(ctx.parsed.y)
              }
            }
          },
          scales: { x: { grid: { color: '#1e2530' }, ticks: { color: '#5a6373' } }, y: { grid: { color: '#1e2530' }, ticks: { color: '#5a6373', callback: v => '$' + formatMoney(v) } } }
        }
      };
    };

    const target = STATE.freedomNetWorth;

    destroyChart('line-a');
    const chartA_Data = compoundAnnuityUntilTarget(STATE.netWorth, STATE.currentReturn, STATE.monthlySavings, target, STATE.currentAge);
    STATE._charts['line-a'] = new Chart(getChart('line-a'), lineConfig(`Growth @ ${STATE.currentReturn}%`, '#f5c518', '245, 197, 24', chartA_Data.data, chartA_Data.labels, 'line-a'));

    destroyChart('line-b');
    const chartB_Data = compoundAnnuityUntilTarget(STATE.netWorth, 15, STATE.monthlySavings, target, STATE.currentAge);
    STATE._charts['line-b'] = new Chart(getChart('line-b'), lineConfig('Growth @ 15%', '#4fc3f7', '79, 195, 247', chartB_Data.data, chartB_Data.labels, 'line-b'));

    const yearsToRetire = STATE.retirementAge - STATE.currentAge;
    const chartC_labels = Array.from({ length: yearsToRetire + 1 }, (_, i) => STATE.currentAge + i);
    const chartC_Data = compoundAnnuity(STATE.netWorth, 15, yearsToRetire, STATE.monthlySavings);
    destroyChart('line-c');
    STATE._charts['line-c'] = new Chart(getChart('line-c'), lineConfig('Max Potential (15% rate)', '#ce93d8', '206, 147, 216', chartC_Data, chartC_labels, 'line-c'));
  }

  function initWebhook() {
    document.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action="submit-plan"]');
      if (!btn) return;

      const status = $('[data-element="submit-status"]');
      btn.disabled = true;
      status.style.display = 'block';
      status.className = 'submit-status loading';
      status.textContent = '⏳ Calculating your roadmap...';

      const cleanPayload = {
        name: STATE.name, email: STATE.email, goal: STATE.goal, concern: STATE.concern, concernOther: STATE.concernOther,
        netWorth: STATE.netWorth, freedomNetWorth: STATE.freedomNetWorth, annualIncome: STATE.annualIncome, monthlySavings: STATE.monthlySavings, currentReturn: STATE.currentReturn,
        currentAge: STATE.currentAge, retirementAge: STATE.retirementAge, allocation: STATE.allocation, behavioral: STATE.behavioral,
        stage: STATE.stage, stageLabel: STATE.stageLabel, riskScores: STATE.riskScores, overallRisk: STATE.overallRisk, criticalCount: STATE.criticalCount,
        timestamp: new Date().toISOString()
      };

      try {
        const res = await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(cleanPayload) });
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

  function formatMoney(n) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  function init() { initUI(); initSliders(); initWebhook(); }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
