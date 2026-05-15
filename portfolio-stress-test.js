<script>
(function () {
  'use strict';

  // ==========================================
  // 1. UTILIDADES COMPARTIDAS
  // ==========================================
  function formatMoney(n) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  }

  // ==========================================
  // 2. LÓGICA: PORTFOLIO STRESS TEST
  // ==========================================
  function initStressTest() {
    if (typeof Chart !== 'undefined') {
      const verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: chart => {
          if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
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
    const ASSET_KEYS = ['cash', 'bonds', 'stocks', 'real-estate', 'bitcoin', 'gold', 'other'];
    const INITIAL_ALLOC = { cash: 10, bonds: 20, stocks: 40, 'real-estate': 15, bitcoin: 5, gold: 5, other: 5 };

    const RISK_INFO = {
      "Inflation": { desc: "Vulnerability to a sustained period of rising consumer prices and currency debasement.", note: "Consider increasing allocation to hard assets (gold, real estate, commodities) or Bitcoin to protect purchasing power." },
      "Concentration": { desc: "Over-reliance on a single asset class or geographic region.", note: "Diversify into non-correlated asset classes to reduce single-point-of-failure risk." },
      "Low Growth": { desc: "Risk of portfolio not outpacing inflation or meeting retirement goals due to low yields.", note: "Allocate more towards equities or growth-focused assets." },
      "Systemic": { desc: "Exposure to broad market crashes and standard financial system failures.", note: "Ensure adequate non-correlated asymmetric hedges." },
      "Deflation Shock": { desc: "Vulnerability to a liquidity crisis, credit contraction, or severe economic slowdown.", note: "Ensure adequate cash reserves or high-quality government bonds to provide optionality during a crash." },
      "Income": { desc: "High dependency on active work. Income is a large percent of net worth.", note: "Build passive income streams and increase emergency reserves to reduce dependency on active income." }
    };

    const RANGE_VALUES = {
      netWorth: { '<10k': 5000, '10k-100k': 50000, '100k-1mm': 500000, '1mm+': 1500000 },
      income: { '<50k': 40000, '50k-100k': 75000, '100k-250k': 175000, '250k-500k': 375000, '500k+': 750000 },
      savings: { '0': 0, '<1k': 500, '1k-5k': 2500, '5k-10k': 7500, '10k+': 15000 },
      returnRate: { '<4%': 2, '4-8%': 6, '8-12%': 10, '12%+': 15 },
      age: { '20s': 25, '30s': 35, '40s': 45, '50s': 55, '60s': 65, '70+': 75 },
      retireAge: { '30s': 35, '40s': 45, '50s': 55, '60s': 65, '70s': 75, '80+': 85 }
    };

    const STATE = {
      goal: '', concerns: [], concernOther: '',
      netWorthStr: '', incomeStr: '', savingsStr: '', returnRateStr: '',
      netWorth: 0, income: 0, savings: 0, returnRate: 0, freedomNumber: 0,
      ageStr: '', retireAgeStr: '', age: 0, retireAge: 0,
      allocation: { ...INITIAL_ALLOC },
      behavioral: {}, name: '', email: '',
      stage: 1, stageLabel: '', riskPoints: {}, totalRiskPoints: 0, vulnerabilityScore: 100, criticalCount: 0,
      currentStep: 1, totalSteps: 8, _charts: {}
    };

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    const validators = {
      1: () => STATE.goal !== '' ? true : "Please select your primary goal.",
      2: () => STATE.concerns.length > 0 ? true : "Please select at least one concern.",
      3: () => (STATE.netWorthStr && STATE.incomeStr && STATE.savingsStr && STATE.returnRateStr) ? true : "Please answer all 4 questions before continuing.",
      4: () => (STATE.ageStr && STATE.retireAgeStr) ? true : "Please select your timeline.",
      5: () => {
         const total = ASSET_KEYS.reduce((sum, k) => sum + STATE.allocation[k], 0);
         return total === 100 ? true : "Total allocation must equal exactly 100%.";
      },
      6: () => (STATE.behavioral.behAccDrop && STATE.behavioral.behIndDrop && STATE.behavioral.behAccGrow && STATE.behavioral.behIndGrow) ? true : "Please answer all 4 behavioral questions.",
      7: () => {
         STATE.name = $('[data-input="name"]') ? $('[data-input="name"]').value.trim() : '';
         STATE.email = $('[data-input="email"]') ? $('[data-input="email"]').value.trim() : '';
         const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
         if(STATE.name.length < 2) return "Please enter a valid name.";
         if(!emailRegex.test(STATE.email)) return "Please enter a valid email address.";
         return true;
      }
    };

    function showError(step, msg) {
      const errEl = $(`#error-step-${step}`);
      if (errEl) { 
        errEl.textContent = "❌ " + msg; 
        errEl.classList.add('visible'); 
      }
    }

    function hideError(step) {
      const errEl = $(`#error-step-${step}`);
      if (errEl) errEl.classList.remove('visible');
    }

    function goToStep(next) {
      if (next < 1 || next > STATE.totalSteps) return;
      
      const currentEl = $(`[data-step="${STATE.currentStep}"]`);
      if (currentEl) currentEl.classList.remove('active');
      
      const nextEl = $(`[data-step="${next}"]`);
      if (nextEl) nextEl.classList.add('active');
      
      STATE.currentStep = next;

      $$('.step-pip').forEach((pip, idx) => {
        if (pip && pip.classList) {
          if (idx < STATE.currentStep) pip.classList.add('active');
          else pip.classList.remove('active');
        }
      });

      if (next === STATE.totalSteps) {
        computeLogic();
        renderResults();

        // Pausa de 50ms para permitir que Webflow pinte el display:block
        setTimeout(() => {
          drawMatrix();
          drawProjections();
        }, 50);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function calculateFreedomNumber() {
      if (STATE.income > 0 && STATE.returnRate > 0) {
        STATE.freedomNumber = STATE.income / (STATE.returnRate / 100);
        const freeNumEl = $('[data-display="mini-freedom-number"]');
        if (freeNumEl) freeNumEl.textContent = formatMoney(STATE.freedomNumber);
      }
    }

    function initSliders() {
      ASSET_KEYS.forEach(key => {
        const s = $(`[data-slider="${key}"]`);
        if (!s) return;
        s.value = INITIAL_ALLOC[key];
        
        const valDisplay = $(`[data-display="value-${key}"]`);
        if (valDisplay) valDisplay.textContent = `${s.value}%`;

        s.addEventListener('input', (e) => {
          STATE.allocation[key] = parseFloat(e.target.value);
          if (valDisplay) valDisplay.textContent = `${e.target.value}%`;

          const total = ASSET_KEYS.reduce((sum, k) => sum + STATE.allocation[k], 0);
          const totalEl = $('[data-display="allocation-total"]');
          if (totalEl) {
            totalEl.textContent = `${total}%`;
            totalEl.style.color = total === 100 ? 'var(--green)' : 'var(--red)';
          }
        });
      });
    }

    function initUI() {
      document.addEventListener('click', e => {
        
        const btnNext = e.target.closest('[data-action="next"]');
        if (btnNext) {
          const step = STATE.currentStep;
          const validation = validators[step] ? validators[step]() : true;

          if (validation === true) { hideError(step); goToStep(step + 1); }
          else { showError(step, validation); }
        }

        if (e.target.closest('[data-action="prev"]')) goToStep(STATE.currentStep - 1);
        if (e.target.closest('[data-action="restart"]')) window.location.reload();

        const btn = e.target.closest('.selection-btn');
        if (btn) {
          const group = btn.closest('.btn-group');
          if (group) {
            const type = group.dataset.group;

            [...group.children].forEach(b => {
               if(b.classList) b.classList.remove('selected');
            });
            btn.classList.add('selected');

            const valStr = btn.dataset.val;
            if (type === 'goal') { STATE.goal = valStr; }
            else if (type && type.startsWith('beh')) { STATE.behavioral[type] = valStr; }
            else if (type) {
              STATE[`${type}Str`] = valStr;
              if (RANGE_VALUES[type]) STATE[type] = RANGE_VALUES[type][valStr];
              if (type === 'income' || type === 'returnRate') calculateFreedomNumber();
            }
          }
        }

        const check = e.target.closest('.concern-check');
        if (check) {
          if (check.classList) check.classList.toggle('selected');
          const val = check.dataset.val;
          if (check.classList && check.classList.contains('selected')) {
            STATE.concerns.push(val);
          } else {
            STATE.concerns = STATE.concerns.filter(c => c !== val);
          }
        }

        if (e.target.closest('[data-action="skip-to-results"]')) goToStep(8);

        if (e.target.closest('[data-action="submit-plan"]')) {
          const validation = validators[7]();
          if (validation === true) { hideError(7); submitToWebhook(); }
          else { showError(7, validation); }
        }
      });
    }

    async function submitToWebhook() {
      const btn = $('[data-action="submit-plan"]');
      const status = $('[data-element="submit-status"]');

      if (btn) btn.disabled = true;
      if (status) {
        status.className = 'submit-status loading';
        status.textContent = '⏳ Calculating your roadmap...';
      }

      computeLogic();

      try {
        const res = await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(STATE) });
        if (res.ok || res.type === 'opaque') { 
           goToStep(8); 
        } else {
           throw new Error();
        }
      } catch (err) {
        if (status) {
          status.className = 'submit-status fail';
          status.textContent = '❌ Connection Error. Please try again.';
        }
        if (btn) btn.disabled = false;
      }
    }

    function computeLogic() {
      const a = STATE.allocation;
      let r = { inflation: 0, concentration: 0, lowGrowth: 0, systemic: 0, deflation: 0, income: 0 };

      const cashBonds = a.cash + a.bonds;
      if (cashBonds > 50) r.inflation = 4;
      else if (cashBonds > 40) r.inflation = 3;
      else if (cashBonds > 30) r.inflation = 2;
      else if (cashBonds > 20) r.inflation = 1;

      const maxAsset = Math.max(...ASSET_KEYS.map(k => a[k]));
      if (maxAsset > 70) r.concentration = 4;
      else if (maxAsset > 60) r.concentration = 3;
      else if (maxAsset > 50) r.concentration = 2;
      else if (maxAsset > 40) r.concentration = 1;

      if (a.stocks < 20) r.lowGrowth += 1;
      if (a.stocks < 10) r.lowGrowth += 1;
      if (STATE.behavioral.behAccGrow === 'never') r.lowGrowth += 1;
      if (STATE.behavioral.behIndGrow === 'never') r.lowGrowth += 1;
      if (STATE.returnRateStr === '4-8%') r.lowGrowth += 2;
      if (STATE.returnRateStr === '<4%') r.lowGrowth += 4;
      r.lowGrowth = Math.min(4, r.lowGrowth);

      const hasFive = a.cash >= 5 && a.stocks >= 5 && a['real-estate'] >= 5 && a.bitcoin >= 5 && a.gold >= 5;
      if (!hasFive) r.systemic += 1;
      if (maxAsset > 50) r.systemic += 2;
      if (STATE.behavioral.behAccDrop === 'never') r.systemic += 1;
      if (a.cash + a.bonds + a.stocks > 70) r.systemic += 3;
      if (a.bitcoin + a.gold + a.other < 10) r.systemic += 3;
      r.systemic = Math.min(4, r.systemic);

      if (maxAsset > 80) r.deflation += 1;
      if (a.cash > 50) r.deflation += 3;
      if (!hasFive) r.deflation += 1;
      r.deflation = Math.min(4, r.deflation);

      const incRatio = STATE.netWorth > 0 ? (STATE.income / STATE.netWorth) : 0;
      if (incRatio >= 3) r.income = 4;
      else if (incRatio >= 1) r.income = 3;
      else if (incRatio >= 0.5) r.income = 2;
      else if (incRatio >= 0.1) r.income = 1;

      STATE.riskPoints = r;
      STATE.totalRiskPoints = Object.values(r).reduce((a, b) => a + b, 0);
      STATE.criticalCount = Object.values(r).filter(v => v >= 4).length;
      STATE.vulnerabilityScore = Math.max(0, Math.round(100 - (STATE.totalRiskPoints * 4.16)));

      let st = 1;
      const absNW = Math.abs(STATE.netWorth);
      if (absNW < 10000) st = 1;
      else if (absNW < 100000) st = 2;
      else if (absNW < 1000000) st = 3;
      else st = 4;

      if (STATE.income >= (absNW * 10)) st = Math.min(4, st + 1);

      const stageLabels = ['Foundation (Debt & Income)', 'Accumulation (Building Portfolio)', 'Aggressive Growth', 'Preservation & Legacy'];
      STATE.stage = st;
      STATE.stageLabel = stageLabels[st - 1];
    }

    function renderResults() {
      const scoreEl = $('[data-result="score"]');
      if (scoreEl) {
        scoreEl.textContent = STATE.vulnerabilityScore;
        if (STATE.vulnerabilityScore >= 75) scoreEl.style.color = 'var(--green)';
        else if (STATE.vulnerabilityScore >= 40) scoreEl.style.color = 'var(--gold)';
        else scoreEl.style.color = 'var(--red)';
      }

      const critEl = $('[data-result="criticals"]');
      if (critEl) critEl.textContent = STATE.criticalCount > 0 ? `⚠ ${STATE.criticalCount} Critical Vulnerabilities` : '✅ No Critical Vulnerabilities';
      
      const stageEl = $('[data-result="stage"]');
      if (stageEl) stageEl.textContent = STATE.stage;
      
      const stageDescEl = $('[data-result="stage-desc"]');
      if (stageDescEl) stageDescEl.textContent = STATE.stageLabel;
      
      const freeEl = $('[data-result="freedom"]');
      if (freeEl) freeEl.textContent = formatMoney(STATE.freedomNumber);

      drawRiskCards();
    }

    function drawRiskCards() {
      const container = document.getElementById('risk-cards-container');
      if (!container) return;
      container.innerHTML = '';

      for (const [key, pts] of Object.entries(STATE.riskPoints)) {
        const nameMap = { inflation: 'Inflation', concentration: 'Concentration', lowGrowth: 'Low Growth', systemic: 'Systemic', deflation: 'Deflation Shock', income: 'Income' };
        const riskName = nameMap[key];

        let cls, txt;
        if (pts < 2) { cls = 'risk-low'; txt = 'Low'; }
        else if (pts < 4) { cls = 'risk-medium'; txt = 'Moderate'; }
        else { cls = 'risk-high'; txt = 'Critical'; }

        const info = RISK_INFO[riskName] || { desc: '', note: '' };

        container.innerHTML += `
          <div class="risk-card-item">
             <div class="risk-card-header"><div class="risk-card-title">${riskName} Risk</div><div class="risk-badge ${cls}">${txt}</div></div>
             <div class="risk-desc">${info.desc}</div>
             <div class="heresy-note">> Heresy Note: ${info.note}</div>
          </div>`;
      }
    }

    function drawMatrix() {
      const canvas = $('[data-chart="radar"]');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (STATE._charts.radar) STATE._charts.radar.destroy();

      STATE._charts.radar = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['Inflation', 'Concentration', 'Low Growth', 'Systemic', 'Deflation Shock', 'Income'],
          datasets: [{
            data: Object.values(STATE.riskPoints).map(v => v * 25),
            backgroundColor: 'rgba(255, 241, 118, 0.6)',
            borderColor: 'var(--red)',
            pointBackgroundColor: 'var(--red)',
            borderWidth: 2, fill: true
          }]
        },
        options: {
          scales: {
            r: {
              min: 0, max: 100, ticks: { display: false },
              grid: { color: 'rgba(230, 237, 233, 0.2)' },
              angleLines: { color: 'rgba(230, 237, 233, 0.2)' },
              pointLabels: { color: '#cbd5e1', font: { family: "'DM Mono'", size: 12 } }
            }
          },
          plugins: { legend: { display: false } }
        }
      });
    }

    function drawProjections() {
      const canvas = $('[data-chart="projections"]');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (STATE._charts.proj) STATE._charts.proj.destroy();

      const dataCurrent = [STATE.netWorth];
      const dataFixed = [STATE.netWorth];
      const labels = ['Now'];

      let balCurrent = STATE.netWorth;
      let balFixed = STATE.netWorth;
      let year = 1;
      const target = STATE.freedomNumber;

      while (balCurrent < target && year <= 60) {
        let r = STATE.returnRate / 100;
        balCurrent = balCurrent * (1 + r) + (STATE.savings * 12);
        dataCurrent.push(balCurrent);

        let rFixed = (STATE.returnRate + 5) / 100;
        balFixed = balFixed * (1 + rFixed) + (STATE.savings * 12);
        dataFixed.push(balFixed);

        labels.push(`Year ${year}`);
        year++;
      }

      STATE._charts.proj = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Current Path', data: dataCurrent, borderColor: '#e84040', borderDash: [5, 5], fill: false, pointRadius: 0 },
            { label: 'Potential Path (Fixed Vulnerabilities)', data: dataFixed, borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.1)', fill: true, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => ' ' + ctx.dataset.label + ': ' + formatMoney(ctx.parsed.y) } }
          },
          scales: {
            y: { ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' } }
          }
        }
      });
    }

    initUI();
    initSliders();
  }

  // ==========================================
  // 3. INICIALIZADOR PRINCIPAL
  // ==========================================
  function initApp() {
    if (document.querySelector('[data-app="stress-test"]')) initStressTest();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
</script>
