(function () {
      'use strict';

      function formatMoney(n) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
      }

      function initStressTest() {
        // Dynamically populate age dropdowns (18 to 100)
        const currentAgeSelect = document.getElementById('currentAgeSelect');
        const retireAgeSelect = document.getElementById('retireAgeSelect');
        if (currentAgeSelect && retireAgeSelect) {
          for (let i = 18; i <= 100; i++) {
            currentAgeSelect.innerHTML += `<option value="${i}">${i}</option>`;
            retireAgeSelect.innerHTML += `<option value="${i}">${i}</option>`;
          }
        }

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
          "Inflation": { desc: "Vulnerability to a sustained period of rising prices and currency debasement.", note: "You may be under allocated to gold, equities, leveraged real estate, or Bitcoin." },
          "Concentration": { desc: "Over-reliance on a single asset or correlated asset class.", note: "You may be under diversified in non-correlated asset classes." },
          "Low Growth": { desc: "Risk of portfolio not outpacing inflation or meeting retirement goals due to low compounding growth rate.", note: "You may be under exposed to growth-focused assets that are vital to long-term wealth creation." },
          "Systemic": { desc: "Exposure to broad market crashes and financial system failures.", note: "You may be vulnerable to bank runs or broad economic shocks with no downside hedges." },
          "Deflation Shock": { desc: "Vulnerability to a liquidity crisis, credit contraction, or severe economic slowdown.", note: "You may have inadequate cash reserves to provide optionality during a deleveraging event." },
          "Income": { desc: "High dependency on active work. Income is a large percent of your net worth.", note: "You may be over-spending a good income and insufficiently saving/investing to meet your financial goals." }
        };

        const RANGE_VALUES = {
          netWorth: { '<10k': 5000, '10k-100k': 50000, '100k-1mm': 500000, '1mm+': 1500000 },
          income: { '<50k': 40000, '50k-100k': 75000, '100k-250k': 175000, '250k-500k': 375000, '500k+': 750000 },
          savings: { '0': 0, '<1k': 500, '1k-5k': 2500, '5k-10k': 7500, '10k+': 15000 },
          returnRate: { '<4%': 2, '4-8%': 6, '8-12%': 10, '12%+': 15 }
        };

        const STATE = {
          goals: [], concerns: [], concernOther: '',
          netWorthStr: '', incomeStr: '', savingsStr: '', returnRateStr: '',
          netWorth: 0, income: 0, savings: 0, returnRate: 0, freedomNumber: 0,
          currentAge: 0, retireAge: 0, targetIncome: 0,
          ageStr: '', retireAgeStr: '',
          allocation: { ...INITIAL_ALLOC },
          behavioral: {}, name: '', email: '',
          stage: 1, stageLabel: '', riskPoints: {}, totalRiskPoints: 0, vulnerabilityScore: 100, criticalCount: 0,
          currentStep: 1, totalSteps: 8, _charts: {}
        };

        const $ = (sel, ctx = document) => ctx.querySelector(sel);
        const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

        function getAgeBucket(age) {
          if (age < 30) return '20s';
          if (age < 40) return '30s';
          if (age < 50) return '40s';
          if (age < 60) return '50s';
          if (age < 70) return '60s';
          return '70+';
        }

        const validators = {
          1: () => STATE.goals.length > 0 ? true : "Please select at least one goal.",
          2: () => STATE.concerns.length > 0 ? true : "Please select at least one concern.",
          3: () => (STATE.netWorthStr && STATE.incomeStr && STATE.savingsStr && STATE.returnRateStr) ? true : "Please answer all 4 questions.",
          4: () => (STATE.currentAge > 0 && STATE.retireAge > 0 && STATE.targetIncome > 0) ? true : "Please answer all 3 timeline questions.",
          5: () => ASSET_KEYS.reduce((sum, k) => sum + STATE.allocation[k], 0) === 100 ? true : "Total allocation must equal exactly 100%.",
          6: () => (STATE.behavioral.behAccDrop && STATE.behavioral.behIndDrop && STATE.behavioral.behAccGrow && STATE.behavioral.behIndGrow) ? true : "Please answer all questions."
        };

        function showError(step, msg) { const errEl = $(`#error-step-${step}`); if (errEl) { errEl.textContent = "❌ " + msg; errEl.classList.add('visible'); } }
        function hideError(step) { const errEl = $(`#error-step-${step}`); if (errEl) errEl.classList.remove('visible'); }

        function goToStep(next) {
          if (next < 1 || next > STATE.totalSteps) return;
          const currentEl = $(`[data-step="${STATE.currentStep}"]`); if (currentEl) currentEl.classList.remove('active');
          const nextEl = $(`[data-step="${next}"]`); if (nextEl) nextEl.classList.add('active');
          STATE.currentStep = next;

          $$('.step-pip').forEach((pip, idx) => {
            if (pip.classList) { idx < STATE.currentStep ? pip.classList.add('active') : pip.classList.remove('active'); }
          });

          // Calculate logic when entering Step 7 (Sneak Peek)
          if (next === 7) {
            computeLogic();
            renderResults();
            setTimeout(() => { drawMatrix(); }, 50);
          }

          // Final Results Dashboard Prep
          if (next === STATE.totalSteps) {
            const diagCards = document.getElementById('diagnostic-cards');
            const insertPoint = document.getElementById('results-diagnostic-insertion');
            const heroHeader = document.getElementById('hero-header');
            const topNav = document.getElementById('top-nav');

            // Hide top menu elements
            if (heroHeader) heroHeader.style.display = 'none';
            if (topNav) topNav.style.display = 'none';

            // Move Diagnostic cards to final results view
            if (diagCards && insertPoint) {
              insertPoint.appendChild(diagCards);
            }
            setTimeout(() => { drawProjections(); }, 50);
          } else {
            const heroHeader = document.getElementById('hero-header');
            const topNav = document.getElementById('top-nav');
            if (heroHeader) heroHeader.style.display = 'block';
            if (topNav) topNav.style.display = 'flex';
          }

          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function initSliders() {
          ASSET_KEYS.forEach(key => {
            const s = $(`[data-slider="${key}"]`); if (!s) return;
            s.value = INITIAL_ALLOC[key];
            const valDisplay = $(`[data-display="value-${key}"]`); if (valDisplay) valDisplay.textContent = `${s.value}%`;

            s.addEventListener('input', (e) => {
              STATE.allocation[key] = parseFloat(e.target.value);
              if (valDisplay) valDisplay.textContent = `${e.target.value}%`;
              const total = ASSET_KEYS.reduce((sum, k) => sum + STATE.allocation[k], 0);
              const totalEl = $('[data-display="allocation-total"]');
              if (totalEl) { totalEl.textContent = `${total}%`; totalEl.style.color = total === 100 ? 'var(--green)' : 'var(--red)'; }
            });
          });
        }

        function initUI() {

          // Dropdown Listeners
          document.addEventListener('change', e => {
            const select = e.target.closest('select.custom-select');
            if (select) {
              const type = select.dataset.group;
              const val = select.value;
              if (type) {
                if (type.startsWith('beh')) STATE.behavioral[type] = val;
                else if (type === 'currentAge') { STATE.currentAge = parseInt(val); STATE.ageStr = getAgeBucket(STATE.currentAge); }
                else if (type === 'retireAge') { STATE.retireAge = parseInt(val); STATE.retireAgeStr = getAgeBucket(STATE.retireAge); }
                else if (type === 'targetIncome') STATE.targetIncome = parseInt(val);
                else {
                  STATE[`${type}Str`] = val;
                  if (RANGE_VALUES[type]) STATE[type] = RANGE_VALUES[type][val];
                }
              }
            }
          });

          document.addEventListener('click', e => {
            // Handle BOTH Continue and Next buttons identically
            const btnNext = e.target.closest('[data-action="next"]');
            if (btnNext) {
              const validation = validators[STATE.currentStep] ? validators[STATE.currentStep]() : true;
              if (validation === true) { hideError(STATE.currentStep); goToStep(STATE.currentStep + 1); }
              else { showError(STATE.currentStep, validation); }
            }

            if (e.target.closest('[data-action="prev"]')) goToStep(STATE.currentStep - 1);
            if (e.target.closest('[data-action="restart"]')) window.location.reload();

            // Checkbox simulation
            const btn = e.target.closest('.radio-btn.multi-select');
            if (btn) {
              btn.classList.toggle('selected');
              const val = btn.dataset.val;
              const group = btn.closest('.btn-group-vertical').dataset.group;

              if (btn.classList.contains('selected')) {
                if (group === 'goal') STATE.goals.push(val);
                else STATE.concerns.push(val);
              } else {
                if (group === 'goal') STATE.goals = STATE.goals.filter(c => c !== val);
                else STATE.concerns = STATE.concerns.filter(c => c !== val);
              }
            }

            if (e.target.closest('[data-action="submit-plan"]')) {
              let tName = $('[data-input="name"]').value.trim();
              let tEmail = $('[data-input="email"]').value.trim();

              if (tName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tEmail)) {
                showError(7, "Please enter a valid name and email address.");
                return;
              }

              hideError(7);
              STATE.name = tName;
              STATE.email = tEmail;
              submitToWebhook();
            }
          });
        }

        async function submitToWebhook() {
          const btns = $$('.btn-main');
          btns.forEach(b => b.disabled = true);

          const status = $('[data-element="submit-status"]');
          if (status) {
            status.className = 'submit-status loading';
            status.textContent = '⏳ Sending...';
            status.style.display = 'block';
          }

          try {
            const cleanPayload = {
              name: STATE.name, email: STATE.email, stage: STATE.stage, stageLabel: STATE.stageLabel,
              riskPoints: STATE.riskPoints, goals: STATE.goals, concerns: STATE.concerns,
              netWorthStr: STATE.netWorthStr, incomeStr: STATE.incomeStr, savingsStr: STATE.savingsStr,
              returnRateStr: STATE.returnRateStr, ageStr: STATE.ageStr, retireAgeStr: STATE.retireAgeStr,
              netWorth: STATE.netWorth, income: STATE.income, savings: STATE.savings, returnRate: STATE.returnRate, targetIncome: STATE.targetIncome,
              allocation: STATE.allocation, behavioral: STATE.behavioral, vulnerabilityScore: STATE.vulnerabilityScore,
              criticalCount: STATE.criticalCount
            };

            await fetch(WEBHOOK_URL, {
              method: 'POST',
              mode: 'no-cors',
              body: JSON.stringify(cleanPayload)
            });

            goToStep(8);

          } catch (err) {
            console.error("Zapier Error:", err);
            if (status) {
              status.className = 'submit-status fail';
              status.textContent = '❌ Webhook Error. Check console.';
            }
            setTimeout(() => goToStep(8), 1000);

          } finally {
            btns.forEach(b => b.disabled = false);
            if (status) {
              status.className = 'submit-status';
              status.textContent = '';
              status.style.display = 'none';
            }
          }
        }

        function computeLogic() {
          STATE.freedomNumber = (STATE.targetIncome > 0 && STATE.returnRate > 0) ? (STATE.targetIncome / (STATE.returnRate / 100)) : 2000000;

          const a = STATE.allocation;
          let r = { inflation: 1, concentration: 1, lowGrowth: 1, systemic: 1, deflation: 1, income: 1 };

          const cashBonds = a.cash + a.bonds;
          if (cashBonds > 50) r.inflation = 4; else if (cashBonds > 35) r.inflation = 3; else if (cashBonds > 20) r.inflation = 2; else r.inflation = 1;

          const maxAsset = Math.max(...ASSET_KEYS.map(k => a[k]));
          if (maxAsset > 70) r.concentration = 4; else if (maxAsset > 50) r.concentration = 3; else if (maxAsset > 30) r.concentration = 2; else r.concentration = 1;

          let lg = 1;
          if (a.stocks < 20) lg += 1;
          if (a.stocks < 10) lg += 1;
          if (STATE.behavioral.behAccGrow === 'never') lg += 1;
          if (STATE.returnRateStr === '4-8%') lg += 1;
          if (STATE.returnRateStr === '<4%') lg += 2;
          r.lowGrowth = Math.min(4, lg);

          let sys = 1;
          const hasFive = a.cash >= 5 && a.stocks >= 5 && a['real-estate'] >= 5 && a.bitcoin >= 5 && a.gold >= 5;
          if (!hasFive) sys += 1;
          if (maxAsset > 50) sys += 1;
          if (a.cash + a.bonds + a.stocks > 80) sys += 1;
          r.systemic = Math.min(4, sys);

          let def = 1;
          if (maxAsset > 80) def += 1;
          if (a.cash > 50) def += 2;
          if (!hasFive) def += 1;
          r.deflation = Math.min(4, def);

          const incRatio = STATE.netWorth > 0 ? (STATE.income / STATE.netWorth) : 0;
          if (incRatio >= 1.0) r.income = 4; else if (incRatio >= 0.5) r.income = 3; else if (incRatio >= 0.2) r.income = 2; else r.income = 1;

          STATE.riskPoints = r;
          STATE.totalRiskPoints = Object.values(r).reduce((a, b) => a + b, 0);
          STATE.criticalCount = Object.values(r).filter(v => v >= 4).length;
          STATE.vulnerabilityScore = Math.max(0, Math.round(100 - (STATE.totalRiskPoints * 4.16)));

          let st = 1; const absNW = Math.abs(STATE.netWorth);
          if (absNW < 10000) st = 1; else if (absNW < 100000) st = 2; else if (absNW < 1000000) st = 3; else st = 4;
          if (STATE.income >= (absNW * 10)) st = Math.min(4, st + 1);

          const stageLabels = ['Stage 1: Your First $10k', 'Stage 2: Your First $100k', 'Stage 3: Your First $1 Million', 'Stage 4: From Freedom to Legacy'];
          STATE.stage = st; STATE.stageLabel = stageLabels[st - 1];
        }

        function renderResults() {
          const scoreEl = $('[data-result="score"]');
          if (scoreEl) {
            scoreEl.innerHTML = `${STATE.vulnerabilityScore} <span style="font-size: 2rem; color: var(--muted);">/100</span>`;
            if (STATE.vulnerabilityScore >= 75) scoreEl.style.color = 'var(--green)'; else if (STATE.vulnerabilityScore >= 40) scoreEl.style.color = 'var(--gold)'; else scoreEl.style.color = 'var(--red)';
          }
          const critEl = $('[data-result="criticals"]'); if (critEl) critEl.textContent = STATE.criticalCount > 0 ? `⚠ ${STATE.criticalCount} Critical Vulnerabilities` : '✅ No Critical Vulnerabilities';
          const stageEl = $('[data-result="stage"]'); if (stageEl) stageEl.textContent = STATE.stageLabel;

          const freedomEl = $('[data-result="freedom"]');
          if (freedomEl) freedomEl.textContent = formatMoney(STATE.freedomNumber);

          drawRiskCards();
        }

        function drawRiskCards() {
          const container = document.getElementById('risk-cards-container'); if (!container) return;
          container.innerHTML = '';
          for (const [key, pts] of Object.entries(STATE.riskPoints)) {
            const nameMap = { inflation: 'Inflation', concentration: 'Concentration', lowGrowth: 'Low Growth', systemic: 'Systemic', deflation: 'Deflation Shock', income: 'Income' };
            const riskName = nameMap[key];
            let cls, txt;
            if (pts === 1) { cls = 'risk-low'; txt = 'Low'; }
            else if (pts === 2) { cls = 'risk-medium'; txt = 'Moderate'; }
            else if (pts === 3) { cls = 'risk-orange'; txt = 'High'; }
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
          const canvas = $('[data-chart="radar"]'); if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (STATE._charts.radar) STATE._charts.radar.destroy();

          const dataValues = Object.values(STATE.riskPoints);
          const bgColors = dataValues.map(v => {
            if (v === 1) return 'rgba(46, 204, 113, 0.8)';
            if (v === 2) return 'rgba(245, 197, 24, 0.8)';
            if (v === 3) return 'rgba(243, 156, 18, 0.8)';
            return 'rgba(232, 64, 64, 0.8)';
          });

          STATE._charts.radar = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: ['Inflation', 'Concentration', 'Low Growth', 'Systemic', 'Deflation', 'Income'],
              datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  min: 0,
                  max: 4,
                  ticks: {
                    stepSize: 1,
                    callback: function (value) {
                      if (value === 1) return 'Low';
                      if (value === 2) return 'Moderate';
                      if (value === 3) return 'High';
                      if (value === 4) return 'Critical';
                      return '';
                    },
                    color: '#cbd5e1',
                    font: { family: "'DM Mono'", size: 12 }
                  },
                  grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                  ticks: {
                    color: '#cbd5e1',
                    font: { family: "'DM Mono'", size: 10 },
                    autoSkip: false,
                    maxRotation: 45,
                    minRotation: 45
                  },
                  grid: { display: false }
                }
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (c) => {
                      const v = c.raw;
                      if (v === 1) return ' Low Risk';
                      if (v === 2) return ' Moderate Risk';
                      if (v === 3) return ' High Risk';
                      return ' Critical Risk';
                    }
                  }
                }
              }
            }
          });
        }

        function drawProjections() {
          const canvas = $('[data-chart="projections"]'); if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (STATE._charts.proj) STATE._charts.proj.destroy();

          let target = STATE.freedomNumber > 0 ? STATE.freedomNumber : 2000000;
          let rCurrent = STATE.returnRate / 100;
          let rFixed = (STATE.returnRate + 5) / 100;
          let annualContribution = STATE.savings * 12;

          let dataCurrent = [STATE.netWorth];
          let dataFixed = [STATE.netWorth];
          let dataTarget = [target];
          let labels = ['Now'];

          let balCurrent = STATE.netWorth;
          let balFixed = STATE.netWorth;

          // Calculamos cuántos años le toma a la Línea Roja tocar la meta
          let yearsToFreedom = 0;
          let tempBal = STATE.netWorth;

          // Aumentamos el límite a 500 para cumplir con Joe: la línea debe tocar la meta aunque tome 200 años.
          while (tempBal < target && yearsToFreedom < 500) {
            yearsToFreedom++;
            tempBal = tempBal * (1 + rCurrent) + annualContribution;
          }
          if (yearsToFreedom === 0) yearsToFreedom = 1;

          for (let i = 1; i <= yearsToFreedom; i++) {
            balCurrent = balCurrent * (1 + rCurrent) + annualContribution;
            dataCurrent.push(balCurrent);

            balFixed = balFixed * (1 + rFixed) + annualContribution;
            dataFixed.push(balFixed);

            dataTarget.push(target);
            labels.push(`Yr ${i}`);
          }

          STATE._charts.proj = new Chart(ctx, {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: 'Potential Path (Fixed)',
                  data: dataFixed,
                  borderColor: '#2ecc71',
                  backgroundColor: 'rgba(46, 204, 113, 0.1)',
                  fill: true,
                  pointRadius: 0
                },
                {
                  label: 'Current Path',
                  data: dataCurrent,
                  borderColor: '#e84040',
                  borderDash: [5, 5],
                  fill: false,
                  pointRadius: 0
                },
                {
                  label: 'Freedom Number Goal',
                  data: dataTarget,
                  borderColor: '#f5c518',
                  borderDash: [2, 2],
                  borderWidth: 2,
                  fill: false,
                  pointRadius: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: { tooltip: { callbacks: { label: (ctx) => ' ' + ctx.dataset.label + ': ' + formatMoney(ctx.parsed.y) } } },
              scales: {
                y: { ticks: { callback: function (v) { if (v >= 1000000) return '$' + (v / 1000000).toFixed(1).replace('.0', '') + 'M'; if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k'; return '$' + v; } } }
              }
            }
          });
        }

        initUI(); initSliders();
      }

      function initApp() { if (document.querySelector('[data-app="stress-test"]')) initStressTest(); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();

    })();
