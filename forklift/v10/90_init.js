/* ===== v10 · запуск ===== */
const chooseVariantPrev10 = chooseVariant;
chooseVariant = function (v, instant = false) {
  if (!VARIANTS[v]) v = '0';
  const ok = chooseVariantPrev10(v, instant);
  for (const [id, [name]] of Object.entries(PLAIN)) if (CAT[id]) CAT[id].name = name;
  CAT.k3.name = capsOf(v).camLayout === '3cam-center' ? 'Камера сзади по центру' : 'Камера сзади слева';
  PlainHelp.k3 = [CAT.k3.name, PLAIN.k3[1]];
  return ok;
};
try { const s = localStorage.getItem('external_view_variant'); if (s && !VARIANTS[s]) localStorage.removeItem('external_view_variant'); } catch { }
if (!VARIANTS[SIM.variant]) chooseVariant('0', true);
Tests.all = () => {
  const checks = {
    variants: V10.ORDER.every(v => VARIANTS[v]),
    prices: Budget.estimate('0').amount === 0 && Budget.estimate('l3').amount > Budget.estimate('k3').amount && Budget.estimate('k4').amount > Budget.estimate('k3').amount,
    rearLamps: ['ledBL', 'ledBR'].every(id => VARIANTS.l.ids.includes(id) && CAT[id])
  };
  return { pass: Object.values(checks).every(Boolean), checks };
};
